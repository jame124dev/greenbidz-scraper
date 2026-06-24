/**
 * @file scheduler/job-runner.js
 * @description The crawl pipeline + the recurring scheduler.
 *
 * Pipeline (per listing URL):
 *   1. Crawl the listing (DOM with pagination, or the API) -> all product URLs.
 *   2. Record EVERY new product as a DB reference (stub, scraped = FALSE);
 *      products already in the DB are skipped (no duplicate).
 *   3. Select which to scrape (recordAndSelect), gated by ONLY_NEW_PRODUCTS:
 *        true  -> only UNSCRAPED rows (scraped = FALSE), newly-discovered first
 *                 then the backlog; already-scraped rows are never re-scraped.
 *        false -> every discovered product (refresh existing too).
 *      The caller caps the count per run (scrapeLimit); the rest stay queued.
 *   4. For each selected: find matching profile, scrape (with retry),
 *      download images, persist to DB, flip scraped = TRUE.
 *   5. If no profile matches: record a pending mapping for review.
 *   6. Log a crawl_history row.
 */

import cron from 'node-cron';
import { crawlListingPage } from '../scrapers/listing-crawler.js';
import { scrapeProduct, scrapeProductWithRetry } from '../scrapers/product-extractor.js';
import { crawlListingApi } from '../scrapers/api-client.js';
import { discoverProductUrls, productUrlPatternFromProfile } from '../scrapers/sitemap-crawler.js';
import { downloadImages } from '../scrapers/image-downloader.js';
import { autoDetectFields } from '../detectors/field-auto-detector.js';
import {
  findMatchingProfile,
  findApiProfileForListing,
  findDomProfileForListing,
  extractUrlPattern,
} from '../detectors/url-pattern-matcher.js';
import {
  upsertProduct,
  updateProductImages,
  recordDiscoveredProduct,
  getUnscrapedUrls,
  getSeenUrls,
  recordProductError,
  recordCrawl,
  addPendingMapping,
  listPendingMappings,
  updatePendingMappingFields,
  countProductsByDomain,
  getLastCrawlTimes,
} from '../database/queries.js';
import { readAllProfiles } from '../utils/file-manager.js';
import { isDue, intervalMinutesOf } from './schedule-util.js';
import { launchBrowser, closeBrowser } from '../config/puppeteer.js';
import { CONSTANTS } from '../config/constants.js';
import { extractDomain } from '../utils/validators.js';
import { logger } from '../utils/logger.js';

/**
 * Persist a normalised product record + download images + mark seen.
 * Shared by both the DOM and API processing paths.
 *
 * @param {object} data - Normalised product (from product-extractor or api-client).
 * @param {string} fileName - Profile filename used.
 * @param {object} profile - The profile object.
 * @returns {Promise<number>} The product id.
 */
async function persistProduct(data, fileName, profile) {
  const productId = await upsertProduct({
    externalId: data.externalId,
    productUrl: data.productUrl,
    profileFileName: fileName,
    rawData: data.rawData,
    title: data.title,
    price: data.price,
    description: data.description,
    imagesLocalPaths: [],
    imagesRemoteUrls: data.imagesRemoteUrls,
  });
  logger.step('💾', `Saved to database (ID: ${productId})`);

  if (profile.downloadImages && data.imagesRemoteUrls?.length) {
    const localPaths = await downloadImages(data.imagesRemoteUrls, productId, {
      sourceUrl: data.productUrl,
      domain: profile.domain || extractDomain(data.productUrl),
    });
    if (localPaths.length) await updateProductImages(productId, localPaths);
  }

  // Note: upsertProduct already set scraped = TRUE / scraped_at on this row.
  return productId;
}

/**
 * Process a single (already-known-to-be-new) product end to end.
 *
 * @param {string} url
 * @param {import('puppeteer').Browser} browser
 * @param {object} [opts]
 * @param {object} [opts.forcedProfile] - { fileName, profile } to force-use.
 * @param {object} [opts.preExtracted] - Already-normalised data (API mode); when
 *                                       present, no scraping/navigation happens.
 * @returns {Promise<{ status: 'saved'|'failed'|'no-mapping', productId?: number }>}
 */
export async function processProductUrl(url, browser, opts = {}) {
  // 1. Resolve profile (forced override wins).
  const match = opts.forcedProfile || (await findMatchingProfile(url));

  if (!match) {
    const pattern = extractUrlPattern(url);
    logger.error(`No mapping found for pattern: ${pattern}`, { url });
    await addPendingMapping({ urlPattern: pattern, sampleUrl: url });
    logger.info('📝 Added to pending_mappings table for review');
    return { status: 'no-mapping' };
  }

  const { fileName, profile } = match;

  try {
    logger.info(`📥 Processing: ${url}`);

    // 2. Obtain data: either pre-extracted (API) or scrape the DOM (with retry).
    const data =
      opts.preExtracted ||
      (await scrapeProductWithRetry(url, profile, { browser }));
    logger.step('✅', `Title: "${data.title}" (using ${fileName})`);

    // 3-5. Persist (sets scraped=TRUE), download images.
    const productId = await persistProduct(data, fileName, profile);

    return { status: 'saved', productId };
  } catch (err) {
    logger.error(`Failed to scrape ${url}: ${err.message}`, {
      url,
      stack: err.stack,
    });
    await recordProductError(url, err.message, fileName).catch(() => {});
    // Leave the discovery-queue row at scraped = FALSE so it is retried on the
    // next cycle (scrape_attempts on the products row tracks repeated failures).
    return { status: 'failed' };
  }
}

/**
 * Record discovered products as DB references, then decide which to scrape.
 *
 *   - Always crawl all products. For each product NOT already in the DB, insert
 *     a stub row (scraped = FALSE) as a reference; existing products are skipped
 *     (no duplicate, never re-recorded).
 *   - ONLY_NEW_PRODUCTS = true (default): scrape only UNSCRAPED products
 *     (scraped = FALSE), newly-discovered first then the older backlog. Already
 *     scraped products (scraped = TRUE) are never re-scraped. The caller caps
 *     the count per run (scrapeLimit); the rest stay queued for the next run.
 *   - ONLY_NEW_PRODUCTS = false: re-scrape every discovered product (refresh).
 *
 * @param {Array<{ productUrl: string, externalId?: string }>} discovered
 * @param {object} [options] - { maxNew }
 * @returns {Promise<{ brandNew: string[], toScrape: Set<string>, mode: string }>}
 */
export async function recordAndSelect(discovered, options = {}) {
  const { maxNew = Infinity, profileFileName = null } = options;
  // Snapshot what's already in the DB so we only create references for new ones.
  const seenBefore = await getSeenUrls();

  const brandNewSet = new Set();
  const brandNew = [];
  let skippedByCap = 0;
  for (const d of discovered) {
    if (seenBefore.has(d.productUrl) || brandNewSet.has(d.productUrl)) continue; // existing/dupe → skip
    if (brandNew.length >= maxNew) {
      skippedByCap += 1;
      continue;
    }
    brandNewSet.add(d.productUrl);
    brandNew.push(d.productUrl);
    // Create the DB reference (stub, scraped = FALSE), tagged with the owning profile.
    // eslint-disable-next-line no-await-in-loop
    await recordDiscoveredProduct(d.productUrl, d.externalId ?? null, profileFileName);
  }

  if (skippedByCap > 0) {
    logger.warn(`Per-profile cap reached — ${skippedByCap} new product(s) not recorded this run.`);
  }

  let toScrape;
  if (CONSTANTS.ONLY_NEW_PRODUCTS) {
    const unscraped = await getUnscrapedUrls();
    // Order: newly-discovered (unscraped) first, then the older backlog still
    // present on the listing. Set preserves insertion order, so the caller's
    // per-run limit takes the freshest products first.
    const ordered = new Set();
    for (const d of discovered) {
      if (brandNewSet.has(d.productUrl)) ordered.add(d.productUrl);
    }
    for (const d of discovered) {
      if (!ordered.has(d.productUrl) && unscraped.has(d.productUrl)) ordered.add(d.productUrl);
    }
    toScrape = ordered;
  } else {
    toScrape = new Set(discovered.map((d) => d.productUrl));
  }

  const mode = CONSTANTS.ONLY_NEW_PRODUCTS ? 'unscraped-only' : 'refresh-all';
  logger.info(
    `🆕 Discovered ${discovered.length} product(s): ${brandNew.length} new reference(s) added; ` +
      `${toScrape.size} unscraped to scrape this cycle (mode: ${mode}).`,
  );
  return { brandNew, toScrape, mode };
}

/**
 * Crawl a listing (DOM) and return discovered products + which to scrape.
 *
 * @param {string} listingUrl
 * @param {object} [options] - { pagination, browser }.
 * @returns {Promise<{ allUrls: string[], toScrape: Set<string>, brandNew: string[], pagesVisited: number }>}
 */
export async function checkForNewProducts(listingUrl, options = {}) {
  const { urls, pagesVisited } = await crawlListingPage(listingUrl, options);
  const discovered = urls.map((u) => ({
    productUrl: u,
    externalId: u.split('/').filter(Boolean).pop(),
  }));
  const { brandNew, toScrape } = await recordAndSelect(discovered, {
    maxNew: options.maxNew,
    profileFileName: options.profileFileName ?? null,
  });
  return { allUrls: urls, toScrape, brandNew, pagesVisited };
}

/**
 * Run one full crawl cycle over a single listing URL.
 *
 * @param {string} listingUrl
 * @param {object} [options]
 * @param {object} [options.pagination]
 * @param {import('puppeteer').Browser} [options.browser]
 * @returns {Promise<object>} Cycle summary.
 */
export async function runCrawlForListing(listingUrl, options = {}) {
  const start = Date.now();

  // ── API-source fast path ──────────────────────────────────────────────────
  // If an API profile claims this listing, crawl the JSON API directly. This
  // needs no headless browser at all.
  const apiProfile = await findApiProfileForListing(listingUrl);
  if (apiProfile) {
    return runApiCrawlForListing(listingUrl, apiProfile, start, options);
  }

  // ── DOM/Puppeteer path ──────────────────────────────────────────────────────
  // Use the pagination config from the DOM profile that owns this listing (built
  // visually in the Mapping Studio), falling back to the listing-crawler defaults.
  const domProfile = await findDomProfileForListing(listingUrl).catch(() => null);

  // ── Sitemap discovery (opt-in via profile.discovery.mode) ───────────────────
  // When a profile opts in, find product URLs from the site's XML sitemap(s)
  // instead of paginating the listing. 'auto' falls back to DOM pagination when
  // the sitemap yields nothing; 'sitemap' uses the sitemap result as-is.
  const discoveryMode = domProfile?.profile?.discovery?.mode;
  if (discoveryMode === 'sitemap' || discoveryMode === 'auto') {
    const sm = await runSitemapCrawlForListing(listingUrl, domProfile, start, options);
    if (sm) return sm; // null only in 'auto' mode with zero matches → fall through
  }

  const pagination = options.pagination || domProfile?.profile?.pagination;
  // Make the silent fallback visible: if no profile pagination was found we use
  // the generic listing-crawler defaults, which rarely match a real site and
  // typically yield 0 products. Surfacing it turns a mystery into a clear hint.
  if (!pagination) {
    logger.warn(
      `No profile pagination found for ${listingUrl} — using generic crawler ` +
        `defaults (likely 0 products). Check the profile's domain/listingUrls match this URL.`,
    );
  }
  // Per-run cap on how many NEW (unscraped) products to scrape; the rest stay
  // queued (scraped = FALSE) for the next run. Saved on the profile.
  const limit = options.limit ?? domProfile?.profile?.scrapeLimit ?? null;

  // Per-profile total cap: stop RECORDING new products once this site hits it.
  const capDomain = domProfile?.profile?.domain || extractDomain(listingUrl);
  const existingForDomain = await countProductsByDomain(capDomain).catch(() => 0);
  const maxNew = Math.max(0, CONSTANTS.MAX_PRODUCTS_PER_PROFILE - existingForDomain);

  const browser = options.browser || (await launchBrowser());
  let found = 0;
  let newCount = 0;
  let scrapedCount = 0;
  let failed = 0;
  let missingMapping = 0;

  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;

  try {
    const { allUrls, toScrape, brandNew } = await checkForNewProducts(listingUrl, {
      pagination,
      browser,
      maxNew,
      profileFileName: domProfile?.fileName ?? null,
    });
    found = allUrls.length;
    newCount = brandNew.length;

    // Apply the per-run limit: scrape only the first N unscraped products.
    let targets = [...toScrape];
    if (limit && limit > 0) targets = targets.slice(0, limit);
    const selectedCount = targets.length; // attempted this run (capped by limit)

    if (limit && limit > 0 && toScrape.size > selectedCount) {
      logger.info(
        `⏳ Scraping ${selectedCount} of ${toScrape.size} new products this run ` +
          `(${toScrape.size - selectedCount} queued for next run).`,
      );
    }

    onProgress?.({ phase: 'discovered', found, total: selectedCount });

    for (const url of targets) {
      if (options.shouldStop?.()) {
        logger.info('🛑 Scrape cancelled by user.');
        break;
      }
      onProgress?.({ phase: 'scraping', current: url });
      // eslint-disable-next-line no-await-in-loop
      const result = await processProductUrl(url, browser, opts(options));
      // Count only products actually scraped & saved (not merely selected).
      if (result.status === 'saved') scrapedCount += 1;
      else if (result.status === 'failed') failed += 1;
      else if (result.status === 'no-mapping') missingMapping += 1;
      onProgress?.({ phase: 'item-done', ok: result.status === 'saved' });
    }

    const duration = Math.round((Date.now() - start) / 1000);
    await recordCrawl({
      listingUrl,
      productsFound: found,
      newProducts: newCount,
      scrapedProducts: scrapedCount,
      failedProducts: failed,
      durationSeconds: duration,
      status: 'completed',
    });

    logger.info(
      `📊 Crawl complete: ${newCount} new, ${scrapedCount} scraped, ` +
        `${failed} failed, ${missingMapping} missing mapping (${duration}s)`,
    );

    return { listingUrl, found, newCount, scrapedCount, failed, missingMapping, duration };
  } catch (err) {
    const duration = Math.round((Date.now() - start) / 1000);
    await recordCrawl({
      listingUrl,
      productsFound: found,
      newProducts: newCount,
      failedProducts: failed,
      durationSeconds: duration,
      status: 'error',
      errorMessage: err.message,
    }).catch(() => {});
    logger.error(`Crawl cycle failed for ${listingUrl}: ${err.message}`, {
      url: listingUrl,
      stack: err.stack,
    });
    return { listingUrl, found, newCount, failed, missingMapping, duration, error: err.message };
  } finally {
    if (!options.browser) await closeBrowser(browser);
  }
}

/**
 * API-source crawl cycle: pull all records from the listing API, diff against
 * the products table, and persist the new ones directly (no headless browser).
 *
 * @param {string} listingUrl
 * @param {{ fileName: string, profile: object }} apiProfile
 * @param {number} start - Cycle start timestamp (ms).
 * @returns {Promise<object>} Cycle summary.
 */
async function runApiCrawlForListing(listingUrl, apiProfile, start, options = {}) {
  const { fileName, profile } = apiProfile;
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  const limit = options.limit ?? profile.scrapeLimit ?? null;
  let found = 0;
  let newCount = 0;
  let scrapedCount = 0;
  let failed = 0;

  try {
    logger.info(`Using API profile "${fileName}" for ${listingUrl}`);
    const { products } = await crawlListingApi(profile);
    found = products.length;

    const byUrl = new Map(products.map((p) => [p.productUrl, p]));

    // Per-profile total cap: stop recording new products for this site at the cap.
    const capDomain = profile.domain || extractDomain(listingUrl);
    const existingForDomain = await countProductsByDomain(capDomain).catch(() => 0);
    const maxNew = Math.max(0, CONSTANTS.MAX_PRODUCTS_PER_PROFILE - existingForDomain);

    // Record every discovered product (capped), then pick which to scrape by the flag.
    const { brandNew, toScrape } = await recordAndSelect(
      products.map((p) => ({ productUrl: p.productUrl, externalId: p.externalId })),
      { maxNew, profileFileName: fileName },
    );
    newCount = brandNew.length;

    // Apply the per-run limit (number of new products to add this run).
    let targets = [...toScrape];
    if (limit && limit > 0) targets = targets.slice(0, limit);
    const selectedCount = targets.length; // attempted this run
    onProgress?.({ phase: 'discovered', found, total: selectedCount });

    for (const url of targets) {
      if (options.shouldStop?.()) {
        logger.info('🛑 Scrape cancelled by user.');
        break;
      }
      const data = byUrl.get(url);
      onProgress?.({ phase: 'scraping', current: url });
      // eslint-disable-next-line no-await-in-loop
      const result = await processProductUrl(url, null, {
        forcedProfile: { fileName, profile },
        preExtracted: data,
      });
      // Count only products actually scraped & saved.
      if (result.status === 'saved') scrapedCount += 1;
      else if (result.status === 'failed') failed += 1;
      onProgress?.({ phase: 'item-done', ok: result.status === 'saved' });
    }

    const duration = Math.round((Date.now() - start) / 1000);
    await recordCrawl({
      listingUrl,
      productsFound: found,
      newProducts: newCount,
      scrapedProducts: scrapedCount,
      failedProducts: failed,
      durationSeconds: duration,
      status: 'completed',
    });
    logger.info(
      `📊 Crawl complete: ${newCount} new, ${scrapedCount} scraped, ` +
        `${failed} failed (API) (${duration}s)`,
    );
    return { listingUrl, found, newCount, scrapedCount, failed, missingMapping: 0, duration };
  } catch (err) {
    const duration = Math.round((Date.now() - start) / 1000);
    await recordCrawl({
      listingUrl,
      productsFound: found,
      newProducts: newCount,
      failedProducts: failed,
      durationSeconds: duration,
      status: 'error',
      errorMessage: err.message,
    }).catch(() => {});
    logger.error(`API crawl failed for ${listingUrl}: ${err.message}`, {
      url: listingUrl,
      stack: err.stack,
    });
    return {
      listingUrl,
      found,
      newCount,
      failed,
      missingMapping: 0,
      duration,
      error: err.message,
    };
  }
}

/**
 * Sitemap-source crawl cycle: discover product URLs from the site's XML
 * sitemap(s) (no listing pagination), then scrape the new ones with the owning
 * DOM profile via the normal per-product path. Mirrors runApiCrawlForListing.
 *
 * @param {string} listingUrl
 * @param {{ fileName: string, profile: object }} domProfile
 * @param {number} start - Cycle start timestamp (ms).
 * @param {object} [options]
 * @returns {Promise<object|null>} Cycle summary, or null when mode is 'auto' and
 *   the sitemap matched nothing (signals the caller to fall back to DOM crawl).
 */
async function runSitemapCrawlForListing(listingUrl, domProfile, start, options = {}) {
  const { fileName, profile } = domProfile;
  const mode = profile?.discovery?.mode;
  const pattern = productUrlPatternFromProfile(profile);
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  const limit = options.limit ?? profile.scrapeLimit ?? null;

  if (!pattern) {
    logger.warn(
      `Sitemap discovery for ${fileName} has no product URL pattern ` +
        `(set discovery.productUrlPattern / pagination.productUrlPattern / urlPattern). ` +
        `${mode === 'auto' ? 'Falling back to DOM crawl.' : 'Skipping.'}`,
    );
    return mode === 'auto' ? null : { listingUrl, found: 0, newCount: 0, scrapedCount: 0, failed: 0, missingMapping: 0, duration: 0 };
  }

  let products = [];
  try {
    const res = await discoverProductUrls({
      siteUrl: listingUrl,
      productUrlPattern: pattern,
      sitemapUrl: profile?.discovery?.sitemapUrl,
    });
    products = res.products;
  } catch (err) {
    logger.error(`Sitemap discovery failed for ${listingUrl}: ${err.message}`);
    if (mode === 'auto') return null; // fall back to DOM crawl
    products = [];
  }

  if (!products.length) {
    if (mode === 'auto') {
      logger.info(`Sitemap matched 0 products for ${listingUrl} — falling back to DOM crawl.`);
      return null;
    }
    logger.warn(`Sitemap matched 0 products for ${listingUrl} (pattern: ${pattern}).`);
  }

  // Per-profile total cap: stop recording new products for this site at the cap.
  const capDomain = profile.domain || extractDomain(listingUrl);
  const existingForDomain = await countProductsByDomain(capDomain).catch(() => 0);
  const maxNew = Math.max(0, CONSTANTS.MAX_PRODUCTS_PER_PROFILE - existingForDomain);

  const { brandNew, toScrape } = await recordAndSelect(
    products.map((p) => ({ productUrl: p.productUrl, externalId: p.externalId })),
    { maxNew, profileFileName: fileName },
  );
  const found = products.length;
  const newCount = brandNew.length;

  let targets = [...toScrape];
  if (limit && limit > 0) targets = targets.slice(0, limit);
  const selectedCount = targets.length;
  onProgress?.({ phase: 'discovered', found, total: selectedCount });

  const browser = options.browser || (await launchBrowser());
  let scrapedCount = 0;
  let failed = 0;
  let missingMapping = 0;
  try {
    for (const url of targets) {
      if (options.shouldStop?.()) {
        logger.info('🛑 Scrape cancelled by user.');
        break;
      }
      onProgress?.({ phase: 'scraping', current: url });
      // eslint-disable-next-line no-await-in-loop
      const result = await processProductUrl(url, browser, { forcedProfile: { fileName, profile } });
      if (result.status === 'saved') scrapedCount += 1;
      else if (result.status === 'failed') failed += 1;
      else if (result.status === 'no-mapping') missingMapping += 1;
      onProgress?.({ phase: 'item-done', ok: result.status === 'saved' });
    }

    const duration = Math.round((Date.now() - start) / 1000);
    await recordCrawl({
      listingUrl,
      productsFound: found,
      newProducts: newCount,
      scrapedProducts: scrapedCount,
      failedProducts: failed,
      durationSeconds: duration,
      status: 'completed',
    });
    logger.info(
      `📊 Crawl complete: ${newCount} new, ${scrapedCount} scraped, ` +
        `${failed} failed (sitemap) (${duration}s)`,
    );
    return { listingUrl, found, newCount, scrapedCount, failed, missingMapping, duration };
  } catch (err) {
    const duration = Math.round((Date.now() - start) / 1000);
    await recordCrawl({
      listingUrl,
      productsFound: found,
      newProducts: newCount,
      failedProducts: failed,
      durationSeconds: duration,
      status: 'error',
      errorMessage: err.message,
    }).catch(() => {});
    logger.error(`Sitemap crawl failed for ${listingUrl}: ${err.message}`, {
      url: listingUrl,
      stack: err.stack,
    });
    return { listingUrl, found, newCount, failed, missingMapping, duration, error: err.message };
  } finally {
    if (!options.browser) await closeBrowser(browser);
  }
}

/** Pass through forced-profile option into processProductUrl. */
function opts(options) {
  return options.forcedProfile ? { forcedProfile: options.forcedProfile } : {};
}

/**
 * Re-detect (and best-effort scrape) URL patterns that have NO profile yet, i.e.
 * rows in pending_mappings. For each, auto-detection is refreshed and the sample
 * product is scraped with an EPHEMERAL (unsaved, unreviewed) profile so unmapped
 * products still land in the DB. This is best-effort: failures are logged, not thrown.
 *
 * @param {object} [options]
 * @param {import('puppeteer').Browser} [options.browser]
 * @returns {Promise<{ processed: number, scraped: number }>}
 */
export async function reprocessPendingMappings({ browser } = {}) {
  const pending = await listPendingMappings('pending').catch(() => []);
  if (!pending.length) return { processed: 0, scraped: 0 };

  logger.info(`🔁 Re-detecting ${pending.length} unmapped pattern(s)…`);
  let scraped = 0;

  for (const row of pending) {
    const sampleUrl = row.sample_url;
    if (!sampleUrl) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      const detection = await autoDetectFields(sampleUrl, { browser });
      // eslint-disable-next-line no-await-in-loop
      await updatePendingMappingFields(row.id, detection.fields || {});

      if (!detection.fields || !detection.fields.title) {
        logger.warn(`No title detected for ${sampleUrl} — refreshed detection only.`);
        continue;
      }

      // Build an ephemeral DOM profile (NOT written to disk).
      const ephemeral = {
        profileId: 'auto_detected',
        profileName: 'Auto-detected (unmapped)',
        urlPattern: extractUrlPattern(sampleUrl),
        domain: extractDomain(sampleUrl),
        source: 'dom',
        downloadImages: false,
        fields: detection.fields,
        selectors: {
          images: detection.imageSelector || 'img',
          waitForSelector: 'h1',
          timeout: 15000,
        },
      };
      // eslint-disable-next-line no-await-in-loop
      const data = await scrapeProduct(sampleUrl, ephemeral, { browser });
      // eslint-disable-next-line no-await-in-loop
      await persistProduct(data, '(auto-detected)', ephemeral);
      scraped += 1;
    } catch (err) {
      logger.warn(`Re-detect/scrape failed for ${sampleUrl}: ${err.message}`);
    }
  }

  logger.info(`🔁 Re-detect complete: ${scraped}/${pending.length} unmapped product(s) scraped.`);
  return { processed: pending.length, scraped };
}

/**
 * Run a crawl cycle over every profile the admin marked as "with job"
 * (scrapeMode === 'auto') and NOT paused, using each profile's own listingUrls.
 * Profiles without scrapeMode (or set to 'manual'/one-time), or with
 * `paused: true`, are skipped — there is NO blanket crawl of .env LISTING_URLS
 * anymore. Also re-detects unmapped patterns.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.onlyDue=false] - When true (the recurring 5-min tick),
 *   only crawl profiles whose own interval has elapsed since their last scrape
 *   (added time as fallback). When false (a manual "Run now"), crawl every
 *   active auto profile regardless of interval.
 * @returns {Promise<object[]>} Per-listing crawl summaries.
 */
export async function runAllAutoProfiles({ onlyDue = false } = {}) {
  const all = await readAllProfiles();
  let autoProfiles = all.filter(
    (e) => e.profile && e.profile.scrapeMode === 'auto' && !e.profile.paused,
  );

  if (!autoProfiles.length) {
    logger.info('No active "with job" (scrapeMode=auto, not paused) profiles — nothing to auto-crawl.');
    return [];
  }

  // Per-profile interval gating: skip profiles not yet due (recurring tick only).
  if (onlyDue) {
    let lastByUrl = new Map();
    try {
      for (const row of await getLastCrawlTimes()) lastByUrl.set(row.listing_url, row.last_timestamp);
    } catch (err) {
      logger.warn(`Could not load crawl times for due-check: ${err.message}`);
      lastByUrl = new Map();
    }
    const now = Date.now();
    const total = autoProfiles.length;
    autoProfiles = autoProfiles.filter((e) => isDue(e.profile, lastByUrl, e.createdAt, now));
    const skipped = total - autoProfiles.length;
    if (!autoProfiles.length) {
      logger.info(`Scheduler tick: no profiles due yet (${skipped} waiting on their interval).`);
      return [];
    }
    if (skipped) logger.info(`Scheduler tick: ${autoProfiles.length} due, ${skipped} not yet due.`);
  }

  logger.info(`▶️  Auto-crawling ${autoProfiles.length} "with job" profile(s).`);
  const browser = await launchBrowser();
  const summaries = [];
  try {
    for (const { fileName, profile } of autoProfiles) {
      const urls = Array.isArray(profile.listingUrls) ? profile.listingUrls.filter(Boolean) : [];
      if (!urls.length) {
        logger.warn(`Auto profile ${fileName} has no listingUrls — skipping.`);
        continue;
      }
      logger.info(`   ↳ ${fileName} (every ${intervalMinutesOf(profile)}m)`);
      for (const url of urls) {
        // eslint-disable-next-line no-await-in-loop
        summaries.push(await runCrawlForListing(url, { browser }));
      }
    }
    // After auto profiles, re-detect + best-effort scrape any unmapped patterns.
    await reprocessPendingMappings({ browser });
  } finally {
    await closeBrowser(browser);
  }
  return summaries;
}

/**
 * Run a crawl cycle across all configured listing URLs, sharing one browser.
 * @param {string[]} [listingUrls=CONSTANTS.LISTING_URLS]
 * @returns {Promise<object[]>}
 */
export async function runAllListings(listingUrls = CONSTANTS.LISTING_URLS) {
  if (!listingUrls.length) {
    logger.warn('No listing URLs configured (set LISTING_URLS in .env).');
    return [];
  }
  const browser = await launchBrowser();
  const summaries = [];
  try {
    for (const listingUrl of listingUrls) {
      // eslint-disable-next-line no-await-in-loop
      summaries.push(await runCrawlForListing(listingUrl, { browser }));
    }
  } finally {
    await closeBrowser(browser);
  }
  return summaries;
}

/**
 * Start the recurring scheduler (standalone CLI path; the Express server uses
 * scheduler-manager.js instead). A fixed 5-minute base tick crawls ONLY the
 * "with job" (scrapeMode === 'auto') profiles whose own interval has elapsed
 * (per-profile `scrapeIntervalMinutes`); there is no blanket crawl of .env
 * LISTING_URLS, and (by default) no immediate run on startup — one-time profiles
 * are run once at save-time by the API, not here.
 *
 * @param {object} [options]
 * @param {boolean} [options.runImmediately=false] - When true, the first tick
 *   runs ALL auto profiles immediately (ignoring their intervals).
 * @returns {import('node-cron').ScheduledTask}
 */
export function startScheduler(options = {}) {
  const { runImmediately = false } = options;
  const expression = '*/5 * * * *'; // base poll every 5 min; profiles run on their own intervals

  logger.info(
    `⏰ Scheduler started — checks every 5 min, crawls "with job" profiles on their own intervals ` +
      `[cron: "${expression}"]`,
  );

  let running = false;
  const tick = async (onlyDue = true) => {
    if (running) {
      logger.warn('Previous crawl still running — skipping this tick.');
      return;
    }
    running = true;
    try {
      await runAllAutoProfiles({ onlyDue });
    } finally {
      running = false;
    }
  };

  const task = cron.schedule(expression, () => tick(true));
  if (runImmediately) tick(false);
  return task;
}

export default {
  processProductUrl,
  recordAndSelect,
  checkForNewProducts,
  runCrawlForListing,
  runAllListings,
  runAllAutoProfiles,
  reprocessPendingMappings,
  startScheduler,
};
