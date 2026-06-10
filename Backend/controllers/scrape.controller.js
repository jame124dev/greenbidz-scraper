/**
 * @file controllers/scrape.controller.js
 * @description Analyze/detect/scrape, job progress/cancel, url-pattern, and the
 * Mapping Studio proxy-page snapshot.
 */
import { logger } from '../utils/logger.js';
import { isValidUrl, extractDomain } from '../utils/validators.js';
import {
  extractUrlPattern,
  findMatchingProfile,
  findApiProfileForListing,
} from '../detectors/url-pattern-matcher.js';
import { autoDetectFields } from '../detectors/field-auto-detector.js';
import { detectApiConfig } from '../detectors/api-detector.js';
import { renderProxyPage } from '../web/proxy/page-proxy.js';
import { getJob, cancelJob } from '../web/jobs.js';
import { runCrawlForListing } from '../scheduler/job-runner.js';
import { startRescrapeJob } from '../services/rescrapeJob.js';
import { crawlListingPage } from '../scrapers/listing-crawler.js';
import { scrapeProduct } from '../scrapers/product-extractor.js';
import { launchBrowser, closeBrowser } from '../config/puppeteer.js';
import { htmlToText } from '../utils/html.js';
import { countProducts } from '../database/queries.js';
import { discoverSampleProductUrls, buildDraftProfile } from '../services/discovery.js';
import { sendHtml } from '../lib/http.js';

/** POST /api/analyze { listingUrl, sampleProductUrl? } */
export async function analyze(req, res) {
  const { listingUrl, sampleProductUrl } = req.body || {};
  if (!isValidUrl(listingUrl)) {
    return res.status(400).json({ error: 'Please enter a valid listing URL (http/https).' });
  }

  const apiProfile = await findApiProfileForListing(listingUrl);
  if (apiProfile) {
    return res.json({
      status: 'existing',
      mode: 'api',
      fileName: apiProfile.fileName,
      profile: apiProfile.profile,
      listingUrl,
    });
  }

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
    return res.json({
      status: 'needs-sample',
      listingUrl,
      message:
        'Could not auto-find product links on this listing (it may be a JS app). ' +
        'Paste a sample product URL to detect its fields.',
    });
  }

  const match = await findMatchingProfile(sample);
  if (match) {
    return res.json({
      status: 'existing',
      mode: match.profile.source === 'api' ? 'api' : 'dom',
      fileName: match.fileName,
      profile: match.profile,
      sampleProductUrl: sample,
      listingUrl,
    });
  }

  let detection = { fields: {}, imageSelector: 'img', detected: {} };
  try {
    detection = await autoDetectFields(sample);
  } catch (err) {
    logger.warn(`Auto-detect failed for ${sample}: ${err.message}`);
  }
  const draft = buildDraftProfile(sample, detection);

  res.json({
    status: 'new',
    listingUrl,
    sampleProductUrl: sample,
    candidates: discovered,
    detected: detection.detected || {},
    draft,
  });
}

/** POST /api/detect { listingUrl, sampleProductUrl?, source } */
export async function detect(req, res) {
  const { listingUrl, sampleProductUrl, source } = req.body || {};
  if (!isValidUrl(listingUrl)) {
    return res.status(400).json({ error: 'Valid listingUrl required.' });
  }

  if (source === 'api') {
    const r = await detectApiConfig(listingUrl, {
      sampleProductUrl:
        sampleProductUrl && isValidUrl(sampleProductUrl) ? sampleProductUrl : undefined,
    });
    return res.json({ source: 'api', ...r });
  }

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
    return res.json({
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
  res.json({
    source: 'dom',
    found: Object.keys(detection.fields || {}).length > 0,
    sampleProductUrl: sample,
    fields: detection.fields || {},
    imageSelector: detection.imageSelector || 'img',
    detected: detection.detected || {},
  });
}

/** POST /api/scrape { listingUrl } */
export async function runScrape(req, res) {
  const { listingUrl } = req.body || {};
  if (!isValidUrl(listingUrl)) {
    return res.status(400).json({ error: 'Valid listingUrl required.' });
  }
  logger.info(`UI-triggered crawl: ${listingUrl}`);
  const summary = await runCrawlForListing(listingUrl, {});
  const counts = await countProducts();
  res.json({ ok: true, summary, counts });
}

/** GET /api/scrape-progress?id= */
export function scrapeProgress(req, res) {
  const id = req.query.id;
  const job = id ? getJob(id) : null;
  if (!job) {
    return res.status(404).json({ error: 'Job not found (it may have expired).' });
  }
  res.json({ job });
}

/** POST /api/scrape-cancel { id } */
export function scrapeCancel(req, res) {
  const { id } = req.body || {};
  const ok = id ? cancelJob(id) : false;
  res.status(ok ? 200 : 404).json({
    ok,
    ...(ok ? {} : { error: 'Job not found or already finished.' }),
  });
}

/** POST /api/url-pattern { url } */
export async function urlPattern(req, res) {
  const { url } = req.body || {};
  if (!isValidUrl(url)) {
    return res.status(400).json({ error: 'Valid url required.' });
  }
  const pattern = extractUrlPattern(url);
  const domain = extractDomain(url);
  const existing = await findMatchingProfile(url).catch(() => null);
  res.json({
    url,
    pattern,
    domain,
    match: existing
      ? { fileName: existing.fileName, profileName: existing.profile?.profileName }
      : null,
  });
}

/**
 * POST /api/test-profile { profile, limit } — crawl the profile's listing for a
 * few product URLs and scrape them with the (unsaved) profile, returning the
 * extracted fields so the admin can confirm the mapping before saving. Nothing
 * is written to the DB. `required` flags are ignored so partial extractions
 * still come back (the UI shows what was/wasn't found).
 */
export async function testProfile(req, res) {
  const { profile, limit = 3 } = req.body || {};
  if (!profile || !Array.isArray(profile.listingUrls) || !profile.listingUrls.length) {
    return res.status(400).json({ error: 'A profile with at least one listingUrl is required.' });
  }
  const n = Math.max(1, Math.min(5, Number(limit) || 3));

  // Don't throw on missing required fields during a test — show partial data.
  const testProfileCfg = {
    ...profile,
    fields: Object.fromEntries(
      Object.entries(profile.fields || {}).map(([k, v]) => [k, { ...v, required: false }]),
    ),
  };

  const browser = await launchBrowser();
  try {
    const listingUrl = profile.listingUrls[0];
    // Only the FIRST listing page — a test needs a handful of links, not the
    // whole catalogue (no pagination), so it's fast.
    const { urls } = await crawlListingPage(listingUrl, {
      pagination: { ...(profile.pagination || {}), maxPages: 1 },
      browser,
    });
    const sample = urls.slice(0, n);
    const results = [];
    for (const url of sample) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const data = await scrapeProduct(url, testProfileCfg, { browser });
        results.push({
          url,
          ok: true,
          title: data.title,
          price: data.price,
          priceRaw: data.priceRaw,
          // Descriptions may be HTML — return clean readable text.
          description: data.description ? htmlToText(data.description).slice(0, 1500) : null,
          images: (data.imagesRemoteUrls || []).slice(0, 12),
          fields: data.rawData || {},
        });
      } catch (err) {
        results.push({ url, ok: false, error: err.message });
      }
    }
    return res.json({ listingUrl, found: urls.length, tested: results.length, results });
  } catch (err) {
    logger.warn(`Test-profile failed: ${err.message}`);
    return res.status(502).json({ error: `Could not test this profile: ${err.message}` });
  } finally {
    await closeBrowser(browser);
  }
}

/** POST /api/rescrape { ids } — re-fetch + overwrite the given products (background). */
export async function rescrape(req, res) {
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || !ids.length) {
    return res.status(400).json({ error: 'ids (non-empty array) required.' });
  }
  const jobId = startRescrapeJob(ids);
  logger.info(`🔁 Rescrape started for ${ids.length} product(s) via UI.`);
  res.status(202).json({ ok: true, jobId, count: ids.length });
}

/** GET /api/proxy-page?url= — sanitized, same-origin snapshot for the Studio iframe. */
export async function proxyPage(req, res) {
  const target = req.query.url;
  if (!isValidUrl(target)) {
    return sendHtml(res, 400, '<h1>Invalid or missing ?url=</h1>');
  }
  try {
    // `fresh` (set by the Reload button) bypasses + refreshes the snapshot cache;
    // normal navigation / back-forward uses the cache for instant revisits.
    const force = req.query.fresh !== undefined;
    const { html } = await renderProxyPage(target, { force });
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
