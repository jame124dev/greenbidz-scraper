/**
 * @file services/sitemapExplorer.js
 * @description Powers the Mapping Studio "Sitemap" step. Summarizes a site's
 *   sitemap into sections (each leaf urlset → counts + sample URLs) so the admin
 *   can browse them and click a sample to derive a product/category URL pattern,
 *   then counts how many URLs a chosen pattern matches.
 *
 *   The full URL list discovered during a summary is cached briefly (in memory,
 *   TTL) keyed by site+sitemap, so pattern match-counts are instant and don't
 *   re-download the (potentially large) sitemap on every keystroke.
 */
import {
  SITEMAP_DEFAULTS,
  locateSitemaps,
  parseSitemapXml,
  fetchSitemapText,
  filterProductUrls,
  originOf,
} from '../scrapers/sitemap-crawler.js';
import { logger } from '../utils/logger.js';

const EXPLORER_DEFAULTS = {
  ...SITEMAP_DEFAULTS,
  maxSections: 80, // cap leaf urlsets summarized
  samplesPerSection: 8, // sample URLs returned per section
  concurrency: 12, // parallel child-sitemap fetches (wall-time ≈ slowest file)
  cacheTtlMs: 10 * 60 * 1000, // 10 min
  cacheMaxEntries: 8,
};

/** @type {Map<string, { at: number, urls: Array<{loc:string,lastmod:string|null}>, summary: object }>} */
const cache = new Map();

function cacheKey(siteUrl, sitemapUrl) {
  let origin = siteUrl;
  try {
    origin = originOf(siteUrl);
  } catch {
    /* keep as-is */
  }
  return `${origin}|${sitemapUrl || ''}`;
}

function getCached(key, ttl) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at <= ttl) return hit;
  if (hit) cache.delete(key);
  return null;
}

function setCached(key, value) {
  cache.set(key, { ...value, at: Date.now() });
  // Evict oldest beyond the cap.
  if (cache.size > EXPLORER_DEFAULTS.cacheMaxEntries) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) cache.delete(oldest[0]);
  }
}

/** Run an async fn over items with a fixed concurrency; preserves order. */
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      // eslint-disable-next-line no-await-in-loop
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

/** A short label for a sitemap section, derived from its filename. */
function sectionLabel(loc) {
  try {
    const last = new URL(loc).pathname.split('/').filter(Boolean).pop() || loc;
    return last.replace(/\.xml(\.gz)?$/i, '');
  } catch {
    return loc;
  }
}

/**
 * Summarize a site's sitemap into sections. Expands sitemap indexes (one or more
 * levels) into their leaf urlsets, fetched in parallel. Caches the full URL list
 * for subsequent match-counts.
 *
 * @param {object} args
 * @param {string} args.siteUrl - Any URL on the site (origin is derived).
 * @param {string} [args.sitemapUrl] - Explicit sitemap (skips robots/probe).
 * @param {object} [opts]
 * @returns {Promise<{
 *   source: string|null,
 *   totalUrls: number,
 *   sections: Array<{ loc:string, label:string, urlCount:number, sampleUrls:string[] }>,
 * }>}
 */
export async function summarizeSitemap({ siteUrl, sitemapUrl }, opts = {}) {
  const cfg = { ...EXPLORER_DEFAULTS, ...opts };
  const key = cacheKey(siteUrl, sitemapUrl);
  const cached = getCached(key, cfg.cacheTtlMs);
  if (cached) return cached.summary;

  // Resolve leaf urlset sitemaps by expanding indexes breadth-first.
  const seeds = sitemapUrl ? [sitemapUrl] : await locateSitemaps(siteUrl, cfg);
  const visited = new Set();
  const leaves = [];
  let queue = [...seeds];
  let fetches = 0;

  while (queue.length && fetches < cfg.maxSitemaps && leaves.length < cfg.maxSections) {
    const batch = queue.splice(0, cfg.concurrency).filter((u) => u && !visited.has(u));
    batch.forEach((u) => visited.add(u));
    if (!batch.length) continue;
    // eslint-disable-next-line no-await-in-loop
    const parsedBatch = await mapLimit(batch, cfg.concurrency, async (u) => {
      const xml = await fetchSitemapText(u, cfg);
      fetches += 1;
      return xml ? { loc: u, parsed: parseSitemapXml(xml) } : null;
    });
    const nextQueue = [];
    for (const item of parsedBatch) {
      if (!item) continue;
      if (item.parsed.type === 'index') {
        for (const child of item.parsed.sitemaps) if (!visited.has(child)) nextQueue.push(child);
      } else {
        leaves.push({ loc: item.loc, urls: item.parsed.urls });
        if (leaves.length >= cfg.maxSections) break;
      }
    }
    queue = nextQueue.concat(queue);
  }

  // Build sections + accumulate the full URL list for caching.
  const allUrls = [];
  const sections = leaves.map((leaf) => {
    for (const u of leaf.urls) allUrls.push(u);
    return {
      loc: leaf.loc,
      label: sectionLabel(leaf.loc),
      urlCount: leaf.urls.length,
      sampleUrls: leaf.urls.slice(0, cfg.samplesPerSection).map((u) => u.loc),
    };
  });
  sections.sort((a, b) => b.urlCount - a.urlCount);

  const summary = {
    source: leaves[0]?.loc ?? null,
    totalUrls: allUrls.length,
    sections,
  };
  setCached(key, { urls: allUrls, summary });
  logger.info(
    `🗺️  Sitemap summary for ${siteUrl}: ${sections.length} section(s), ${allUrls.length} URL(s).`,
  );
  return summary;
}

/**
 * Count how many sitemap URLs match a pattern. Uses the cached URL list from a
 * prior summarize when available; otherwise summarizes first.
 *
 * @param {object} args
 * @param {string} args.siteUrl
 * @param {string} [args.sitemapUrl]
 * @param {string} args.pattern - Regex source to test URLs against.
 * @param {object} [opts]
 * @returns {Promise<{ matched:number, total:number, samples:string[] }>}
 */
export async function matchSitemap({ siteUrl, sitemapUrl, pattern }, opts = {}) {
  if (!pattern) throw new Error('matchSitemap: pattern is required');
  // Validate the regex up front so a bad pattern is a clean 400, not a 500.
  try {
    // eslint-disable-next-line no-new
    new RegExp(pattern);
  } catch (err) {
    const e = new Error(`Invalid pattern: ${err.message}`);
    e.statusCode = 400;
    throw e;
  }

  const cfg = { ...EXPLORER_DEFAULTS, ...opts };
  const key = cacheKey(siteUrl, sitemapUrl);
  let cached = getCached(key, cfg.cacheTtlMs);
  if (!cached) {
    await summarizeSitemap({ siteUrl, sitemapUrl }, opts);
    cached = getCached(key, cfg.cacheTtlMs);
  }
  const urls = cached?.urls ?? [];
  const matches = filterProductUrls(urls, pattern);
  return {
    matched: matches.length,
    total: urls.length,
    samples: matches.slice(0, 10).map((m) => m.productUrl),
  };
}

export default { summarizeSitemap, matchSitemap, EXPLORER_DEFAULTS };
