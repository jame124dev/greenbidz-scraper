/**
 * @file scrapers/sitemap-crawler.js
 * @description Discover product URLs from a site's XML sitemap(s) — no headless
 *   browser required. This is the cheapest, most complete discovery strategy:
 *   one (or a few) HTTP fetches can surface every product on a site, bypassing
 *   categories and pagination entirely.
 *
 *   Pipeline:
 *     1. Locate the sitemap(s): read robots.txt for `Sitemap:` lines, then fall
 *        back to common well-known paths (/sitemap.xml, /sitemap_index.xml, …).
 *     2. Fetch + parse each sitemap. A document is either a `<urlset>` (page
 *        URLs) or a `<sitemapindex>` (links to child sitemaps). Indexes are
 *        followed recursively (bounded by maxSitemaps + a visited set).
 *     3. Keep only `<loc>` URLs matching the profile's product URL pattern.
 *        Each kept URL carries its `<lastmod>` (when present) — useful later for
 *        cheap change-detection (only re-check products whose lastmod advanced).
 *
 *   The pure parsing helpers (parseSitemapXml, extractRobotsSitemaps,
 *   filterProductUrls, maybeGunzip) take no network and are unit-tested offline.
 */

import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { logger } from '../utils/logger.js';

const gunzip = promisify(zlib.gunzip);

/** Default safety bounds so a misconfigured/huge site can't run away. */
export const SITEMAP_DEFAULTS = {
  maxSitemaps: 50, // hard cap on sitemap documents fetched per discovery
  maxUrls: 50000, // hard cap on MATCHED product URLs collected
  fetchTimeoutMs: 45000, // per-request timeout (large item sitemaps stream slowly)
  // A browser-like UA. Many sites (e.g. labx.com) 403 obvious bot UAs even for
  // their public sitemaps; a normal browser string is accepted. Sitemaps are
  // public crawl aids, so this stays within robots policy. Override per-call via
  // opts.userAgent if a site needs something specific.
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};

/** Well-known sitemap locations to probe when robots.txt yields nothing. */
export const COMMON_SITEMAP_PATHS = [
  '/sitemap.xml',
  '/sitemap_index.xml',
  '/sitemap-index.xml',
  '/product-sitemap.xml',
  '/wp-sitemap.xml', // WordPress core
  '/sitemap/sitemap.xml',
];

// ── Pure helpers (no network — unit-tested offline) ──────────────────────────

/**
 * Decode the handful of XML entities that legitimately appear inside <loc>.
 * @param {string} s
 * @returns {string}
 */
export function decodeXmlEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)));
}

/** Pull the text of the first <tag>…</tag> inside a block (namespace-tolerant). */
function firstTag(block, tag) {
  // Allow optional namespace prefix (e.g. <ns:loc>) and surrounding whitespace.
  const re = new RegExp(`<(?:[a-zA-Z0-9]+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:[a-zA-Z0-9]+:)?${tag}>`, 'i');
  const m = block.match(re);
  return m ? decodeXmlEntities(m[1].trim()) : null;
}

/** Match every <tag>…</tag> block (namespace-tolerant), returning inner text. */
function eachBlock(xml, tag) {
  const re = new RegExp(`<(?:[a-zA-Z0-9]+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:[a-zA-Z0-9]+:)?${tag}>`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

/**
 * Parse a sitemap document into either child-sitemap links (index) or page
 * URLs (urlset). Determined by the root element, not by guessing.
 *
 * @param {string} xml - Raw sitemap XML.
 * @returns {{ type: 'index'|'urlset', sitemaps: string[], urls: Array<{ loc: string, lastmod: string|null }> }}
 */
export function parseSitemapXml(xml) {
  const text = String(xml || '');
  const isIndex = /<sitemapindex\b/i.test(text);

  if (isIndex) {
    const sitemaps = [];
    for (const block of eachBlock(text, 'sitemap')) {
      const loc = firstTag(block, 'loc');
      if (loc) sitemaps.push(loc);
    }
    return { type: 'index', sitemaps, urls: [] };
  }

  const urls = [];
  for (const block of eachBlock(text, 'url')) {
    const loc = firstTag(block, 'loc');
    if (!loc) continue;
    urls.push({ loc, lastmod: firstTag(block, 'lastmod') });
  }
  // Fallback: some sitemaps are a bare list of <loc> with no <url> wrappers.
  if (!urls.length && /<loc\b/i.test(text)) {
    const re = /<(?:[a-zA-Z0-9]+:)?loc\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9]+:)?loc>/gi;
    let m;
    while ((m = re.exec(text)) !== null) urls.push({ loc: decodeXmlEntities(m[1].trim()), lastmod: null });
  }
  return { type: 'urlset', sitemaps: [], urls };
}

/**
 * Extract `Sitemap:` directives from a robots.txt body.
 * @param {string} robotsTxt
 * @returns {string[]} Absolute sitemap URLs.
 */
export function extractRobotsSitemaps(robotsTxt) {
  const out = [];
  for (const line of String(robotsTxt || '').split(/\r?\n/)) {
    const m = line.match(/^\s*sitemap\s*:\s*(\S+)/i);
    if (m) out.push(m[1].trim());
  }
  return out;
}

/**
 * Filter discovered locs down to product URLs by a regex pattern, dedupe, and
 * shape them for the crawl pipeline.
 *
 * @param {Array<{ loc: string, lastmod: string|null }>} entries
 * @param {string|RegExp} productUrlPattern - Regex source or RegExp.
 * @param {Set<string>} [seen] - Shared dedupe set, to filter across many
 *   sitemaps without re-matching the same URL. Defaults to a fresh set.
 * @returns {Array<{ productUrl: string, externalId: string, lastmod: string|null }>}
 */
export function filterProductUrls(entries, productUrlPattern, seen = new Set()) {
  const re = productUrlPattern instanceof RegExp ? productUrlPattern : new RegExp(productUrlPattern);
  const out = [];
  for (const e of entries || []) {
    const loc = e && e.loc;
    if (!loc || seen.has(loc) || !re.test(loc)) continue;
    seen.add(loc);
    out.push({
      productUrl: loc,
      externalId: loc.split(/[?#]/)[0].split('/').filter(Boolean).pop() || loc,
      lastmod: e.lastmod ?? null,
    });
  }
  return out;
}

/**
 * Gunzip a buffer when it is gzip-compressed (magic bytes 1f 8b) or the source
 * URL ends in .gz; otherwise return it as-is. Returns a utf-8 string.
 * @param {Buffer|Uint8Array} buf
 * @param {string} [url]
 * @returns {Promise<string>}
 */
export async function maybeGunzip(buf, url = '') {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  const looksGzip = b.length > 2 && b[0] === 0x1f && b[1] === 0x8b;
  if (looksGzip || /\.gz(\?|$)/i.test(url)) {
    const out = await gunzip(b);
    return out.toString('utf8');
  }
  return b.toString('utf8');
}

/** Build an origin (scheme://host) from any URL on the site. */
export function originOf(url) {
  const u = new URL(url);
  return `${u.protocol}//${u.host}`;
}

/**
 * Resolve which regex a profile uses to recognise a product URL, for sitemap
 * filtering. Precedence: explicit discovery pattern → pagination pattern →
 * the profile's own urlPattern.
 * @param {object} profile
 * @returns {string|null}
 */
export function productUrlPatternFromProfile(profile) {
  return (
    profile?.discovery?.productUrlPattern ||
    profile?.pagination?.productUrlPattern ||
    profile?.urlPattern ||
    null
  );
}

// ── Network layer ────────────────────────────────────────────────────────────

/**
 * Fetch a URL and return its decompressed text body, or null on any failure.
 * Exported as `fetchSitemapText` for reuse by the sitemap-explorer service.
 * @param {string} url
 * @param {object} [opts]
 * @returns {Promise<string|null>}
 */
export async function fetchSitemapText(url, opts = {}) {
  const { fetchTimeoutMs, userAgent } = { ...SITEMAP_DEFAULTS, ...opts };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), fetchTimeoutMs);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      redirect: 'follow',
      headers: { 'user-agent': userAgent, accept: 'application/xml,text/xml,text/plain,*/*' },
    });
    if (!res.ok) {
      logger.warn(`Sitemap fetch ${res.status} for ${url}`);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return await maybeGunzip(buf, url);
  } catch (err) {
    logger.warn(`Sitemap fetch failed for ${url}: ${err.message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Locate candidate sitemap URLs for a site: robots.txt directives first, then
 * common well-known paths (which are probed lazily by the caller).
 * @param {string} siteUrl - Any URL on the target site.
 * @param {object} [opts]
 * @returns {Promise<string[]>} Ordered, de-duplicated candidate sitemap URLs.
 */
export async function locateSitemaps(siteUrl, opts = {}) {
  const origin = originOf(siteUrl);
  const candidates = [];

  const robots = await fetchSitemapText(`${origin}/robots.txt`, opts);
  if (robots) {
    for (const sm of extractRobotsSitemaps(robots)) candidates.push(sm);
  }
  for (const p of COMMON_SITEMAP_PATHS) candidates.push(`${origin}${p}`);

  // De-dupe, preserve order (robots.txt entries first).
  return [...new Set(candidates)];
}

/**
 * Discover product URLs for a site via its sitemap(s).
 *
 * @param {object} args
 * @param {string} args.siteUrl - Any URL on the target site (origin is derived).
 * @param {string|RegExp} args.productUrlPattern - Keep only locs matching this.
 * @param {string} [args.sitemapUrl] - Explicit sitemap URL (skips robots/probe).
 * @param {object} [opts] - Overrides for SITEMAP_DEFAULTS bounds.
 * @returns {Promise<{
 *   products: Array<{ productUrl: string, externalId: string, lastmod: string|null }>,
 *   sitemapsFetched: number,
 *   source: string|null,
 * }>}
 */
export async function discoverProductUrls({ siteUrl, productUrlPattern, sitemapUrl }, opts = {}) {
  const cfg = { ...SITEMAP_DEFAULTS, ...opts };
  if (!productUrlPattern) throw new Error('discoverProductUrls: productUrlPattern is required');

  // Seed queue: explicit sitemap if given, else located candidates.
  const queue = sitemapUrl ? [sitemapUrl] : await locateSitemaps(siteUrl, cfg);
  const visited = new Set();
  const seen = new Set(); // shared product-URL dedupe across all sitemaps
  /** @type {Array<{ productUrl: string, externalId: string, lastmod: string|null }>} */
  const products = [];
  let urlsSeen = 0; // total <loc> entries scanned (for logging)
  let sitemapsFetched = 0;
  let firstWorkingSource = null;

  // Filter EACH urlset as it arrives and cap on MATCHED products — so sitemaps
  // that contain no products (cms, categories, …) never exhaust the budget
  // before a later product sitemap is reached.
  while (queue.length && sitemapsFetched < cfg.maxSitemaps && products.length < cfg.maxUrls) {
    const next = queue.shift();
    if (!next || visited.has(next)) continue;
    visited.add(next);

    // eslint-disable-next-line no-await-in-loop
    const xml = await fetchSitemapText(next, cfg);
    if (!xml) continue;
    sitemapsFetched += 1;

    const parsed = parseSitemapXml(xml);
    if (parsed.type === 'index') {
      for (const child of parsed.sitemaps) if (!visited.has(child)) queue.push(child);
      continue;
    }
    urlsSeen += parsed.urls.length;
    const matched = filterProductUrls(parsed.urls, productUrlPattern, seen);
    if (matched.length) {
      if (!firstWorkingSource) firstWorkingSource = next;
      for (const m of matched) {
        products.push(m);
        if (products.length >= cfg.maxUrls) break;
      }
    }
  }

  if (products.length >= cfg.maxUrls) {
    logger.warn(`Sitemap discovery hit maxUrls=${cfg.maxUrls} matched products — stopping early.`);
  }
  logger.info(
    `🗺️  Sitemap discovery: ${sitemapsFetched} sitemap(s) fetched, ` +
      `${urlsSeen} URL(s) seen, ${products.length} matched the product pattern.`,
  );
  return { products, sitemapsFetched, source: firstWorkingSource };
}

export default {
  SITEMAP_DEFAULTS,
  COMMON_SITEMAP_PATHS,
  decodeXmlEntities,
  parseSitemapXml,
  extractRobotsSitemaps,
  filterProductUrls,
  maybeGunzip,
  originOf,
  productUrlPatternFromProfile,
  locateSitemaps,
  discoverProductUrls,
};
