/**
 * @file web/server.js
 * @description Lightweight HTTP API server (no framework). API-only: it exposes
 *              the /api/* routes consumed by the separate Vite frontend
 *              (../../Frontend, dev on http://localhost:5173). It serves NO HTML —
 *              the UI is its own project.
 *
 * Run: `npm run web`  (default http://localhost:4000)
 */

import http from 'node:http';

import { CONSTANTS } from '../config/constants.js';
import { logger } from '../utils/logger.js';
import { isValidUrl, validateProfile, extractDomain } from '../utils/validators.js';
import {
  writeProfile,
  profileExists,
  readAllProfiles,
  readProfile,
  deleteProfile,
} from '../utils/file-manager.js';
import { extractUrlPattern, findMatchingProfile, findApiProfileForListing } from '../detectors/url-pattern-matcher.js';
import { autoDetectFields } from '../detectors/field-auto-detector.js';
import { detectApiConfig } from '../detectors/api-detector.js';
import { launchBrowser, newPage, goto, closeBrowser } from '../config/puppeteer.js';
import { renderProxyPage } from './proxy/page-proxy.js';
import { createJob, getJob, jobProgress, cancelJob, isCancelled, finishJob, failJob } from './jobs.js';
import { runCrawlForListing } from '../scheduler/job-runner.js';
import {
  listRecentProducts,
  countProducts,
  listPendingMappings,
  listCrawlHistory,
  getProductById,
  getLastCrawlTimes,
} from '../database/queries.js';
import { testConnection } from '../config/database.js';

// Backend runs on its own port (default 4000). The Vite frontend (5173) calls
// these /api routes directly (cross-origin), so CORS is required.
// Override port with WEB_PORT, allowed origin with CORS_ORIGIN (default *).
const PORT = Number.parseInt(process.env.WEB_PORT, 10) || 4000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

function applyCors(res) {
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

// ── helpers ──────────────────────────────────────────────────────────────────

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendHtml(res, status, html) {
  // Deliberately NO X-Frame-Options / restrictive CSP: this HTML is meant to be
  // framed by our own Mapping Studio (same origin).
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(html);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
}

/**
 * Render a listing page and try to discover candidate product-detail links
 * using a generic heuristic (works for normal anchor-based listings; SPA sites
 * that navigate via JS — like 101lab — return none, in which case the user can
 * supply a sample product URL manually).
 *
 * @param {string} listingUrl
 * @returns {Promise<string[]>} candidate product URLs (most-likely first)
 */
async function discoverSampleProductUrls(listingUrl) {
  const browser = await launchBrowser();
  const page = await newPage(browser);
  try {
    await goto(page, listingUrl);
    await new Promise((r) => setTimeout(r, 3000)); // SPA settle
    const links = await page.evaluate((listing) => {
      const origin = location.origin;
      const listingPath = new URL(listing, origin).pathname.replace(/\/$/, '');
      const groups = {};
      for (const a of Array.from(document.querySelectorAll('a[href]'))) {
        let href;
        try {
          href = new URL(a.getAttribute('href'), origin).href;
        } catch {
          continue;
        }
        const u = new URL(href);
        if (u.origin !== origin) continue; // same-site only
        const p = u.pathname.replace(/\/$/, '');
        if (p === listingPath || p === '') continue;
        // product-detail-ish: deeper than listing OR has a numeric/slug segment
        const looksProduct = /\/\d+(?:$|\/)/.test(p) || /[a-z0-9-]{6,}$/i.test(p);
        if (!looksProduct) continue;
        const key = p.replace(/\d+/g, '#'); // group by templated path
        (groups[key] = groups[key] || []).push(href);
      }
      // pick the largest group (most repeated template = product cards)
      const best = Object.values(groups).sort((a, b) => b.length - a.length)[0] || [];
      return Array.from(new Set(best)).slice(0, 5);
    }, listingUrl);
    return links;
  } finally {
    await page.close().catch(() => {});
    await closeBrowser(browser);
  }
}

/** Build an editable DOM-mode draft profile from auto-detected fields. */
function buildDraftProfile(sampleProductUrl, detection) {
  const domain = extractDomain(sampleProductUrl) || 'example.com';
  const slug = domain.replace(/[^a-z0-9]+/gi, '').toLowerCase();
  const now = new Date().toISOString();
  return {
    profileId: `profile_${slug}`,
    profileName: `${domain} Product Scraper`,
    urlPattern: extractUrlPattern(sampleProductUrl),
    domain,
    source: 'dom',
    createdAt: now,
    updatedAt: now,
    downloadImages: true,
    sampleUrl: sampleProductUrl,
    fields: Object.keys(detection.fields || {}).length
      ? detection.fields
      : { title: { selector: 'h1', type: 'text', required: true } },
    selectors: {
      images: detection.imageSelector || 'img',
      waitForSelector: 'h1',
      timeout: 15000,
    },
    usageCount: 0,
    _suggestedFileName: `profile_${slug}.json`,
  };
}

// ── route handlers ───────────────────────────────────────────────────────────

/** POST /api/analyze { listingUrl, sampleProductUrl? } */
async function handleAnalyze(req, res) {
  const { listingUrl, sampleProductUrl } = await readBody(req);
  if (!isValidUrl(listingUrl)) {
    return sendJson(res, 400, { error: 'Please enter a valid listing URL (http/https).' });
  }

  // 1. Does an API profile already own this listing?
  const apiProfile = await findApiProfileForListing(listingUrl);
  if (apiProfile) {
    return sendJson(res, 200, {
      status: 'existing',
      mode: 'api',
      fileName: apiProfile.fileName,
      profile: apiProfile.profile,
      listingUrl,
    });
  }

  // 2. Find a sample product URL (user-supplied wins; else discover from listing).
  let sample = sampleProductUrl && isValidUrl(sampleProductUrl) ? sampleProductUrl : null;
  let discovered = [];
  if (!sample) {
    try {
      discovered = await discoverSampleProductUrls(listingUrl);
      sample = discovered[0] || null;
    } catch (err) {
      logger.warn(`Discovery failed for ${listingUrl}: ${err.message}`);
    }
  }

  if (!sample) {
    return sendJson(res, 200, {
      status: 'needs-sample',
      listingUrl,
      message:
        'Could not auto-find product links on this listing (it may be a JS app). ' +
        'Paste a sample product URL to detect its fields.',
    });
  }

  // 3. Does an existing DOM profile already match the sample product?
  const match = await findMatchingProfile(sample);
  if (match) {
    return sendJson(res, 200, {
      status: 'existing',
      mode: match.profile.source === 'api' ? 'api' : 'dom',
      fileName: match.fileName,
      profile: match.profile,
      sampleProductUrl: sample,
      listingUrl,
    });
  }

  // 4. New pattern → auto-detect fields and return an editable draft.
  let detection = { fields: {}, imageSelector: 'img', detected: {} };
  try {
    detection = await autoDetectFields(sample);
  } catch (err) {
    logger.warn(`Auto-detect failed for ${sample}: ${err.message}`);
  }
  const draft = buildDraftProfile(sample, detection);

  return sendJson(res, 200, {
    status: 'new',
    listingUrl,
    sampleProductUrl: sample,
    candidates: discovered,
    detected: detection.detected || {},
    draft,
  });
}

/**
 * POST /api/detect { listingUrl, sampleProductUrl?, source }
 * Re-analyze the site for a specific source and return auto-detected fields.
 *   - source = 'dom' → render a sample product, return CSS-selector fields.
 *   - source = 'api' → sniff the listing's JSON requests, return an api block.
 */
async function handleDetect(req, res) {
  const { listingUrl, sampleProductUrl, source } = await readBody(req);
  if (!isValidUrl(listingUrl)) {
    return sendJson(res, 400, { error: 'Valid listingUrl required.' });
  }

  if (source === 'api') {
    const r = await detectApiConfig(listingUrl, {
      sampleProductUrl: sampleProductUrl && isValidUrl(sampleProductUrl) ? sampleProductUrl : undefined,
    });
    return sendJson(res, 200, { source: 'api', ...r });
  }

  // DOM: need a sample product URL (user-supplied or discovered).
  let sample = sampleProductUrl && isValidUrl(sampleProductUrl) ? sampleProductUrl : null;
  if (!sample) {
    try {
      const found = await discoverSampleProductUrls(listingUrl);
      sample = found[0] || null;
    } catch (err) {
      logger.warn(`DOM detect discovery failed: ${err.message}`);
    }
  }
  if (!sample) {
    return sendJson(res, 200, {
      source: 'dom',
      found: false,
      message: 'Could not find a sample product URL. Paste one to detect DOM selectors.',
    });
  }
  let detection = { fields: {}, imageSelector: 'img', detected: {} };
  try {
    detection = await autoDetectFields(sample);
  } catch (err) {
    logger.warn(`DOM detect failed: ${err.message}`);
  }
  return sendJson(res, 200, {
    source: 'dom',
    found: Object.keys(detection.fields || {}).length > 0,
    sampleProductUrl: sample,
    fields: detection.fields || {},
    imageSelector: detection.imageSelector || 'img',
    detected: detection.detected || {},
  });
}

/**
 * Start a background crawl over the given listing URLs as a tracked job, so the
 * UI can poll /api/scrape-progress for live progress. Returns the job id.
 * @param {string[]} listingUrls
 * @returns {string} jobId
 */
function startCrawlJob(listingUrls) {
  const jobId = createJob({ listingUrls });
  const onProgress = jobProgress(jobId);
  const shouldStop = () => isCancelled(jobId);
  (async () => {
    try {
      for (const u of listingUrls) {
        if (isCancelled(jobId)) break;
        try {
          logger.info(`▶️  Job ${jobId} crawl: ${u}`);
          await runCrawlForListing(u, { onProgress, shouldStop });
        } catch (err) {
          logger.warn(`Job ${jobId} crawl failed for ${u}: ${err.message}`);
        }
      }
      if (isCancelled(jobId)) finishJob(jobId, { status: 'cancelled', phase: 'cancelled' });
      else finishJob(jobId);
    } catch (err) {
      failJob(jobId, err.message);
    }
  })();
  return jobId;
}

/** GET /api/scrape-progress?id= — poll a running/finished crawl job. */
function handleScrapeProgress(res, urlObj) {
  const id = urlObj.searchParams.get('id');
  const job = id ? getJob(id) : null;
  if (!job) {
    return sendJson(res, 404, { error: 'Job not found (it may have expired).' });
  }
  return sendJson(res, 200, { job });
}

/** POST /api/scrape-cancel { id } — request a running job to stop. */
async function handleScrapeCancel(req, res) {
  const { id } = await readBody(req);
  const ok = id ? cancelJob(id) : false;
  return sendJson(res, ok ? 200 : 404, {
    ok,
    ...(ok ? {} : { error: 'Job not found or already finished.' }),
  });
}

/** POST /api/save-profile { fileName, profile } */
async function handleSaveProfile(req, res) {
  const body = await readBody(req);
  let { fileName } = body;
  const { profile } = body;
  if (!profile || typeof profile !== 'object') {
    return sendJson(res, 400, { error: 'Missing profile object.' });
  }
  delete profile._suggestedFileName;
  profile.updatedAt = new Date().toISOString();

  const { valid, errors } = validateProfile(profile);
  if (!valid) {
    return sendJson(res, 400, { error: 'Profile invalid', details: errors });
  }

  if (!fileName) {
    const slug = (profile.domain || 'site').replace(/[^a-z0-9]+/gi, '').toLowerCase();
    fileName = `profile_${slug}.json`;
  }
  if (!fileName.endsWith('.json')) fileName += '.json';

  const overwrote = profileExists(fileName);
  const full = await writeProfile(fileName, profile);
  logger.success(`Profile saved via UI: ${full}`);

  // Run-once-on-save: immediately crawl this profile's listing URL(s) one time
  // (fire-and-forget). For one-time profiles this is their only run; for "with
  // job" profiles it's the first run and the scheduler continues on its interval.
  const listingUrls = Array.isArray(profile.listingUrls)
    ? profile.listingUrls.filter(isValidUrl)
    : [];
  const runNow = body.runNow !== false && listingUrls.length > 0;
  const jobId = runNow ? startCrawlJob(listingUrls) : null;

  return sendJson(res, 200, {
    ok: true,
    fileName,
    overwrote,
    path: full,
    runStarted: !!jobId,
    jobId,
  });
}

/** POST /api/scrape { listingUrl } */
async function handleScrape(req, res) {
  const { listingUrl } = await readBody(req);
  if (!isValidUrl(listingUrl)) {
    return sendJson(res, 400, { error: 'Valid listingUrl required.' });
  }
  logger.info(`UI-triggered crawl: ${listingUrl}`);
  const summary = await runCrawlForListing(listingUrl, {});
  const counts = await countProducts();
  return sendJson(res, 200, { ok: true, summary, counts });
}

/** GET /api/products?limit=&scrapedOnly= */
async function handleProducts(res, urlObj) {
  const limit = Number.parseInt(urlObj.searchParams.get('limit'), 10) || 50;
  const scrapedOnly = urlObj.searchParams.get('scrapedOnly') === 'true';
  const products = await listRecentProducts({ limit, scrapedOnly });
  const counts = await countProducts();
  return sendJson(res, 200, { counts, products });
}

/** GET /api/proxy-page?url= — sanitized, same-origin snapshot for the Studio iframe. */
async function handleProxyPage(res, urlObj) {
  const target = urlObj.searchParams.get('url');
  if (!isValidUrl(target)) {
    return sendHtml(res, 400, '<h1>Invalid or missing ?url=</h1>');
  }
  try {
    const { html } = await renderProxyPage(target);
    return sendHtml(res, 200, html);
  } catch (err) {
    logger.error(`Proxy-page failed for ${target}: ${err.message}`);
    return sendHtml(
      res,
      502,
      `<body style="font:14px system-ui;background:#0f172a;color:#e2e8f0;padding:24px">
         <h2>Could not render this page</h2>
         <p style="color:#94a3b8">${err.message}</p>
       </body>`,
    );
  }
}

/** POST /api/url-pattern { url } — generate the regex pattern + dedupe check. */
async function handleUrlPattern(req, res) {
  const { url } = await readBody(req);
  if (!isValidUrl(url)) {
    return sendJson(res, 400, { error: 'Valid url required.' });
  }
  const pattern = extractUrlPattern(url);
  const domain = extractDomain(url);
  const existing = await findMatchingProfile(url).catch(() => null);
  return sendJson(res, 200, {
    url,
    pattern,
    domain,
    match: existing
      ? { fileName: existing.fileName, profileName: existing.profile?.profileName }
      : null,
  });
}

/** GET /api/products/:id */
async function handleProductById(res, id) {
  const numId = Number.parseInt(id, 10);
  if (!Number.isInteger(numId)) {
    return sendJson(res, 400, { error: 'Invalid product id.' });
  }
  const product = await getProductById(numId);
  if (!product) {
    return sendJson(res, 404, { error: 'Product not found.' });
  }
  return sendJson(res, 200, { product });
}

/** GET /api/crawl-history?limit=N */
async function handleCrawlHistory(res, urlObj) {
  const limit = Number.parseInt(urlObj.searchParams.get('limit'), 10) || 100;
  const history = await listCrawlHistory({ limit });
  return sendJson(res, 200, { history });
}

/**
 * Next scheduled crawl time for the global cron `0 *\/N * * *` (every N hours on
 * the hour, local time). Returns an ISO string. Mirrors the scheduler's
 * CRAWL_INTERVAL_HOURS so the UI can show "next scrape in …" for auto profiles.
 * @returns {string}
 */
function computeNextRun() {
  const interval = Math.max(1, CONSTANTS.CRAWL_INTERVAL_HOURS || 2);
  const now = new Date();
  for (let h = 0; h < 24; h += interval) {
    const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, 0, 0, 0);
    if (candidate.getTime() > now.getTime()) return candidate.toISOString();
  }
  // Past the last slot today → first slot (midnight) tomorrow.
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0).toISOString();
}

/** GET /api/profiles — list saved profiles with enough detail for the Profiles page. */
async function handleProfiles(res) {
  const all = await readAllProfiles();

  // "Last scraped" per listing URL, derived from crawl_history. Best-effort: if
  // the DB is unavailable the page still renders (timestamps just show as null).
  const lastByUrl = new Map();
  try {
    for (const row of await getLastCrawlTimes()) {
      lastByUrl.set(row.listing_url, row.last_timestamp);
    }
  } catch (err) {
    logger.warn(`Could not load crawl times for profiles: ${err.message}`);
  }
  const nextRun = computeNextRun();

  const profiles = all
    .filter((e) => e.profile)
    .map(({ fileName, profile }) => {
      const listingUrls = Array.isArray(profile.listingUrls) ? profile.listingUrls : [];
      const paused = !!profile.paused;
      const scrapeMode = profile.scrapeMode || null;

      // Most-recent crawl across any of this profile's listing URLs.
      let lastScrapedAt = null;
      for (const url of listingUrls) {
        const ts = lastByUrl.get(url);
        if (ts && (!lastScrapedAt || new Date(ts) > new Date(lastScrapedAt))) lastScrapedAt = ts;
      }

      return {
        fileName,
        profileId: profile.profileId,
        profileName: profile.profileName,
        domain: profile.domain,
        source: profile.source || 'dom',
        scrapeMode,
        scrapeLimit: profile.scrapeLimit ?? null,
        downloadImages: !!profile.downloadImages,
        paused,
        urlPattern: profile.urlPattern,
        listingUrls,
        fieldCount: profile.fields ? Object.keys(profile.fields).length : 0,
        hasImages: !!(profile.selectors && profile.selectors.images),
        updatedAt: profile.updatedAt || null,
        lastScrapedAt,
        // Only auto + not-paused profiles are picked up by the scheduler.
        nextScrapeAt: scrapeMode === 'auto' && !paused ? nextRun : null,
      };
    });
  return sendJson(res, 200, { profiles });
}

/** Settings the Profiles page is allowed to change on an existing profile. */
const EDITABLE_SETTINGS = ['scrapeMode', 'scrapeLimit', 'downloadImages', 'paused'];

/**
 * POST /api/profile-settings { fileName, settings } — lightweight, partial
 * update of an EXISTING profile's run settings. Unlike /api/save-profile it
 * does NOT re-validate the whole profile and does NOT trigger a crawl; it just
 * merges the allowed keys and writes the file back.
 */
async function handleProfileSettings(req, res) {
  const body = await readBody(req);
  const { fileName, settings } = body;
  if (!fileName || typeof fileName !== 'string') {
    return sendJson(res, 400, { error: 'fileName required.' });
  }
  if (!settings || typeof settings !== 'object') {
    return sendJson(res, 400, { error: 'settings object required.' });
  }
  const fn = fileName.endsWith('.json') ? fileName : `${fileName}.json`;
  if (!profileExists(fn)) {
    return sendJson(res, 404, { error: `Profile not found: ${fn}` });
  }

  const profile = await readProfile(fn);

  if ('scrapeMode' in settings) {
    if (settings.scrapeMode !== 'auto' && settings.scrapeMode !== 'manual') {
      return sendJson(res, 400, { error: "scrapeMode must be 'auto' or 'manual'." });
    }
    profile.scrapeMode = settings.scrapeMode;
  }
  if ('scrapeLimit' in settings) {
    const v = settings.scrapeLimit;
    if (v === null || v === '') {
      profile.scrapeLimit = null;
    } else {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1) {
        return sendJson(res, 400, { error: 'scrapeLimit must be a positive integer or null.' });
      }
      profile.scrapeLimit = n;
    }
  }
  if ('downloadImages' in settings) profile.downloadImages = !!settings.downloadImages;
  if ('paused' in settings) profile.paused = !!settings.paused;

  // Ignore anything not explicitly editable (defensive).
  const unknown = Object.keys(settings).filter((k) => !EDITABLE_SETTINGS.includes(k));
  if (unknown.length) logger.warn(`Ignored non-editable profile settings: ${unknown.join(', ')}`);

  profile.updatedAt = new Date().toISOString();
  const full = await writeProfile(fn, profile);
  logger.success(`Profile settings updated via UI: ${full}`);

  return sendJson(res, 200, {
    ok: true,
    fileName: fn,
    settings: {
      scrapeMode: profile.scrapeMode || null,
      scrapeLimit: profile.scrapeLimit ?? null,
      downloadImages: !!profile.downloadImages,
      paused: !!profile.paused,
    },
  });
}

/** POST /api/delete-profile { fileName } — permanently delete a profile file. */
async function handleDeleteProfile(req, res) {
  const { fileName } = await readBody(req);
  if (!fileName || typeof fileName !== 'string') {
    return sendJson(res, 400, { error: 'fileName required.' });
  }
  const fn = fileName.endsWith('.json') ? fileName : `${fileName}.json`;
  if (!profileExists(fn)) {
    return sendJson(res, 404, { error: `Profile not found: ${fn}` });
  }
  await deleteProfile(fn);
  logger.success(`Profile deleted via UI: ${fn}`);
  return sendJson(res, 200, { ok: true, fileName: fn });
}

/** POST /api/run-profile { fileName } — crawl this profile's listing URL(s) now (async). */
async function handleRunProfile(req, res) {
  const { fileName } = await readBody(req);
  if (!fileName || typeof fileName !== 'string') {
    return sendJson(res, 400, { error: 'fileName required.' });
  }
  const fn = fileName.endsWith('.json') ? fileName : `${fileName}.json`;
  if (!profileExists(fn)) {
    return sendJson(res, 404, { error: `Profile not found: ${fn}` });
  }
  const profile = await readProfile(fn);
  const listingUrls = (Array.isArray(profile.listingUrls) ? profile.listingUrls : []).filter(
    isValidUrl,
  );
  if (!listingUrls.length) {
    return sendJson(res, 400, {
      error: 'This profile has no listingUrls to crawl. Re-build it in the Mapping Studio.',
    });
  }
  // Tracked background job so the UI can poll progress.
  const jobId = startCrawlJob(listingUrls);
  return sendJson(res, 200, { ok: true, runStarted: true, fileName: fn, listingUrls, jobId });
}

/** GET /api/state */
async function handleState(res) {
  const [counts, profiles, pending] = await Promise.all([
    countProducts(),
    readAllProfiles(),
    listPendingMappings('pending').catch(() => []),
  ]);
  return sendJson(res, 200, {
    counts,
    profiles: profiles.map((p) => ({
      fileName: p.fileName,
      profileName: p.profile?.profileName,
      domain: p.profile?.domain,
      source: p.profile?.source || 'dom',
      urlPattern: p.profile?.urlPattern,
    })),
    pending,
    listingUrls: CONSTANTS.LISTING_URLS,
  });
}

// ── server ───────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://localhost:${PORT}`);
  const { pathname } = urlObj;

  // CORS for the cross-origin Vite frontend; short-circuit preflight requests.
  applyCors(res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  try {
    // Root: a tiny API banner (the UI lives in the separate Frontend project).
    if (req.method === 'GET' && pathname === '/') {
      return sendJson(res, 200, {
        ok: true,
        service: 'product-monitor-api',
        ui: 'Run the Frontend project (Vite) at http://localhost:5173',
      });
    }
    if (req.method === 'GET' && pathname === '/api/state') return await handleState(res);
    if (req.method === 'GET' && pathname === '/api/profiles') return await handleProfiles(res);
    if (req.method === 'POST' && pathname === '/api/profile-settings') return await handleProfileSettings(req, res);
    if (req.method === 'POST' && pathname === '/api/delete-profile') return await handleDeleteProfile(req, res);
    if (req.method === 'POST' && pathname === '/api/run-profile') return await handleRunProfile(req, res);
    if (req.method === 'GET' && pathname === '/api/scrape-progress') return handleScrapeProgress(res, urlObj);
    if (req.method === 'POST' && pathname === '/api/scrape-cancel') return await handleScrapeCancel(req, res);
    if (req.method === 'GET' && pathname === '/api/products') return await handleProducts(res, urlObj);
    if (req.method === 'GET' && pathname === '/api/crawl-history') return await handleCrawlHistory(res, urlObj);
    if (req.method === 'GET' && pathname === '/api/proxy-page') return await handleProxyPage(res, urlObj);
    if (req.method === 'POST' && pathname === '/api/url-pattern') return await handleUrlPattern(req, res);
    if (req.method === 'GET' && pathname.startsWith('/api/products/')) {
      return await handleProductById(res, pathname.slice('/api/products/'.length));
    }
    if (req.method === 'POST' && pathname === '/api/analyze') return await handleAnalyze(req, res);
    if (req.method === 'POST' && pathname === '/api/detect') return await handleDetect(req, res);
    if (req.method === 'POST' && pathname === '/api/save-profile') return await handleSaveProfile(req, res);
    if (req.method === 'POST' && pathname === '/api/scrape') return await handleScrape(req, res);

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  } catch (err) {
    logger.error(`Web request failed (${pathname}): ${err.message}`, { stack: err.stack });
    sendJson(res, 500, { error: err.message });
  }
});

server.listen(PORT, async () => {
  logger.info(`🌐 API server running at http://localhost:${PORT} (UI: Frontend on :5173)`);
  try {
    await testConnection();
    logger.success('Database connection OK.');
  } catch (err) {
    logger.warn(`DB not reachable yet: ${err.message} (start MySQL / run "npm run setup")`);
  }
});
