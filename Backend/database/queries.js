/**
 * @file database/queries.js
 * @description All MySQL data-access operations for Product Monitor.
 *              No SQL lives outside this module.
 */

import { query } from '../config/database.js';

/**
 * JSON arrays are stored in JSON columns. mysql2 returns JSON columns already
 * parsed into JS values, but we normalise defensively on read.
 * @param {*} value
 * @returns {Array<*>}
 */
function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

// ── products: discovery queue (the `scraped` flag lives here now) ────────────
//
// There is no separate seen_products table. A product is "discovered" by
// inserting a stub row with scraped = FALSE; a successful scrape fills the row
// in and flips scraped = TRUE (see upsertProduct).

/**
 * Check whether a product URL already exists in products.
 * @param {string} productUrl
 * @returns {Promise<boolean>}
 */
export async function hasSeenProduct(productUrl) {
  const rows = await query(
    'SELECT 1 FROM products WHERE product_url = ? LIMIT 1',
    [productUrl],
  );
  return rows.length > 0;
}

/**
 * Fetch the full set of known product URLs (for brand-new detection).
 * @returns {Promise<Set<string>>}
 */
export async function getSeenUrls() {
  const rows = await query('SELECT product_url FROM products');
  return new Set(rows.map((r) => r.product_url));
}

/**
 * Fetch the set of product URLs that have NOT yet been scraped
 * (products.scraped = FALSE).
 * @returns {Promise<Set<string>>}
 */
export async function getUnscrapedUrls() {
  const rows = await query(
    'SELECT product_url FROM products WHERE scraped = FALSE',
  );
  return new Set(rows.map((r) => r.product_url));
}

/**
 * Record a discovered product as a stub row (scraped = FALSE) if it does not
 * already exist. Existing rows are left untouched except for last_seen_at.
 * This is the "store the id with scraped:false" step.
 *
 * @param {string} productUrl
 * @param {string} [externalId]
 * @returns {Promise<void>}
 */
export async function recordDiscoveredProduct(productUrl, externalId = null) {
  await query(
    `INSERT INTO products (external_id, product_url, raw_data, scraped)
     VALUES (?, ?, ?, FALSE)
     ON DUPLICATE KEY UPDATE
       last_seen_at = CURRENT_TIMESTAMP,
       external_id  = COALESCE(VALUES(external_id), external_id)`,
    [externalId ?? (productUrl.split('/').filter(Boolean).pop() || productUrl), productUrl, JSON.stringify({})],
  );
}

/**
 * Explicitly flag a product as scraped. (upsertProduct already does this on a
 * successful scrape; this is kept for ad-hoc use.)
 * @param {string} productUrl
 * @returns {Promise<void>}
 */
export async function markProductScraped(productUrl) {
  await query(
    'UPDATE products SET scraped = TRUE, scraped_at = CURRENT_TIMESTAMP WHERE product_url = ?',
    [productUrl],
  );
}

// ── products: full scrape persistence ────────────────────────────────────────

/**
 * Insert or update a product row (upsert on product_url).
 *
 * @param {object} data
 * @param {string} data.externalId
 * @param {string} data.productUrl
 * @param {string} data.profileFileName
 * @param {object} data.rawData            - Arbitrary scraped payload.
 * @param {string} [data.title]
 * @param {number|null} [data.price]
 * @param {string} [data.description]
 * @param {string[]} [data.imagesLocalPaths]
 * @param {string[]} [data.imagesRemoteUrls]
 * @returns {Promise<number>} The product id (existing or newly inserted).
 */
export async function upsertProduct(data) {
  const {
    externalId,
    productUrl,
    profileFileName,
    rawData,
    title = null,
    price = null,
    description = null,
    imagesLocalPaths = [],
    imagesRemoteUrls = [],
  } = data;

  await query(
    `INSERT INTO products
       (external_id, product_url, profile_file_name, raw_data, title, price,
        description, images_local_paths, images_remote_urls,
        first_seen_at, last_seen_at, is_active, scraped, scraped_at, scrape_attempts)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, TRUE, TRUE, CURRENT_TIMESTAMP, 1)
     ON DUPLICATE KEY UPDATE
       external_id        = VALUES(external_id),
       profile_file_name  = VALUES(profile_file_name),
       raw_data           = VALUES(raw_data),
       title              = VALUES(title),
       price              = VALUES(price),
       description        = VALUES(description),
       images_local_paths = VALUES(images_local_paths),
       images_remote_urls = VALUES(images_remote_urls),
       last_seen_at       = CURRENT_TIMESTAMP,
       is_active          = TRUE,
       scraped            = TRUE,
       scraped_at         = CURRENT_TIMESTAMP,
       scrape_attempts    = scrape_attempts + 1,
       last_error         = NULL`,
    [
      externalId,
      productUrl,
      profileFileName,
      JSON.stringify(rawData ?? {}),
      title,
      price,
      description,
      JSON.stringify(imagesLocalPaths ?? []),
      JSON.stringify(imagesRemoteUrls ?? []),
    ],
  );

  const rows = await query(
    'SELECT id FROM products WHERE product_url = ? LIMIT 1',
    [productUrl],
  );
  return rows.length ? rows[0].id : null;
}

/**
 * Update the locally-downloaded image paths for an existing product.
 * @param {number} productId
 * @param {string[]} localPaths
 * @returns {Promise<void>}
 */
export async function updateProductImages(productId, localPaths) {
  await query('UPDATE products SET images_local_paths = ? WHERE id = ?', [
    JSON.stringify(localPaths ?? []),
    productId,
  ]);
}

/**
 * Record a scrape failure against a product URL (creates a stub row if needed).
 * @param {string} productUrl
 * @param {string} errorMessage
 * @param {string} [profileFileName]
 * @returns {Promise<void>}
 */
export async function recordProductError(productUrl, errorMessage, profileFileName = null) {
  await query(
    `INSERT INTO products
       (external_id, product_url, profile_file_name, raw_data, is_active,
        scrape_attempts, last_error)
     VALUES (?, ?, ?, ?, FALSE, 1, ?)
     ON DUPLICATE KEY UPDATE
       scrape_attempts = scrape_attempts + 1,
       last_error      = VALUES(last_error),
       last_seen_at    = CURRENT_TIMESTAMP`,
    [
      productUrl.split('/').pop() || productUrl,
      productUrl,
      profileFileName,
      JSON.stringify({}),
      errorMessage,
    ],
  );
}

/**
 * Fetch a product row by URL.
 * @param {string} productUrl
 * @returns {Promise<object|null>}
 */
export async function getProductByUrl(productUrl) {
  const rows = await query(
    'SELECT * FROM products WHERE product_url = ? LIMIT 1',
    [productUrl],
  );
  if (!rows.length) return null;
  const row = rows[0];
  row.images_local_paths = asArray(row.images_local_paths);
  row.images_remote_urls = asArray(row.images_remote_urls);
  return row;
}

/**
 * Override the profile used for a product (manual override feature).
 * @param {string} productUrl
 * @param {string} profileFileName
 * @returns {Promise<void>}
 */
export async function setProductProfile(productUrl, profileFileName) {
  await query(
    `INSERT INTO products (external_id, product_url, profile_file_name, raw_data)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE profile_file_name = VALUES(profile_file_name)`,
    [
      productUrl.split('/').pop() || productUrl,
      productUrl,
      profileFileName,
      JSON.stringify({}),
    ],
  );
}

// ── crawl_history ─────────────────────────────────────────────────────────────

/**
 * Insert a crawl-history record.
 * @param {object} entry
 * @returns {Promise<number>} Inserted row id.
 */
export async function recordCrawl(entry) {
  const {
    listingUrl,
    productsFound = 0,
    newProducts = 0,
    failedProducts = 0,
    durationSeconds = 0,
    status = 'completed',
    errorMessage = null,
  } = entry;

  const result = await query(
    `INSERT INTO crawl_history
       (listing_url, products_found, new_products, failed_products,
        crawl_duration_seconds, status, error_message)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      listingUrl,
      productsFound,
      newProducts,
      failedProducts,
      durationSeconds,
      status,
      errorMessage,
    ],
  );
  return result.insertId;
}

// ── pending_mappings ──────────────────────────────────────────────────────────

/**
 * Insert a pending mapping for review when no profile matches a URL pattern.
 * Idempotent on url_pattern.
 * @param {object} entry
 * @param {string} entry.urlPattern
 * @param {string} entry.sampleUrl
 * @param {object} [entry.autoDetectedFields]
 * @returns {Promise<void>}
 */
export async function addPendingMapping({ urlPattern, sampleUrl, autoDetectedFields = null }) {
  await query(
    `INSERT INTO pending_mappings (url_pattern, sample_url, auto_detected_fields, status)
     VALUES (?, ?, ?, 'pending')
     ON DUPLICATE KEY UPDATE sample_url = VALUES(sample_url)`,
    [
      urlPattern,
      sampleUrl,
      autoDetectedFields ? JSON.stringify(autoDetectedFields) : null,
    ],
  );
}

/**
 * List pending mappings (optionally filtered by status).
 * @param {string} [status='pending']
 * @returns {Promise<object[]>}
 */
export async function listPendingMappings(status = 'pending') {
  return query(
    'SELECT * FROM pending_mappings WHERE status = ? ORDER BY created_at DESC',
    [status],
  );
}

/**
 * Refresh the auto-detected fields stored against a pending mapping (used when
 * re-detecting unmapped patterns on a scheduled run).
 * @param {number} id
 * @param {object} autoDetectedFields
 * @returns {Promise<void>}
 */
export async function updatePendingMappingFields(id, autoDetectedFields) {
  await query(
    'UPDATE pending_mappings SET auto_detected_fields = ? WHERE id = ?',
    [JSON.stringify(autoDetectedFields ?? {}), id],
  );
}

// ── read helpers (for the web UI / reporting) ────────────────────────────────

/**
 * List recently-seen products, newest first, with image arrays parsed.
 * @param {object} [opts]
 * @param {number} [opts.limit=50]
 * @param {boolean} [opts.scrapedOnly=false] - Only rows where scraped = TRUE.
 * @returns {Promise<object[]>}
 */
export async function listRecentProducts({ limit = 50, scrapedOnly = false } = {}) {
  const lim = Math.max(1, Math.min(500, Number(limit) || 50));
  const where = scrapedOnly ? 'WHERE scraped = TRUE' : '';
  const rows = await query(
    `SELECT id, external_id, product_url, profile_file_name, title, price,
            scraped, scraped_at, first_seen_at, last_seen_at, is_active,
            images_local_paths, images_remote_urls, last_error
     FROM products ${where}
     ORDER BY last_seen_at DESC
     LIMIT ${lim}`,
  );
  return rows.map((r) => ({
    ...r,
    scraped: !!r.scraped,
    is_active: !!r.is_active,
    images_local_paths: asArray(r.images_local_paths),
    images_remote_urls: asArray(r.images_remote_urls),
  }));
}

/**
 * Count products grouped by scraped flag.
 * @returns {Promise<{ total: number, scraped: number, unscraped: number }>}
 */
export async function countProducts() {
  const rows = await query(
    `SELECT
       COUNT(*) AS total,
       SUM(scraped = TRUE) AS scraped,
       SUM(scraped = FALSE) AS unscraped
     FROM products`,
  );
  const r = rows[0] || {};
  return {
    total: Number(r.total) || 0,
    scraped: Number(r.scraped) || 0,
    unscraped: Number(r.unscraped) || 0,
  };
}

/**
 * Count products belonging to a site/domain (matched on the product URL host).
 * Used to enforce the per-profile product cap during discovery.
 * @param {string} domain - e.g. "www.labassets.com"
 * @returns {Promise<number>}
 */
export async function countProductsByDomain(domain) {
  if (!domain) return 0;
  const rows = await query(
    'SELECT COUNT(*) AS n FROM products WHERE product_url LIKE ?',
    [`%://${domain}/%`],
  );
  return Number(rows[0]?.n) || 0;
}

/**
 * List recent crawl-history runs, newest first (for the History/Logs UI).
 * @param {object} [opts]
 * @param {number} [opts.limit=100]
 * @returns {Promise<object[]>}
 */
export async function listCrawlHistory({ limit = 100 } = {}) {
  const lim = Math.max(1, Math.min(500, Number(limit) || 100));
  return query(
    `SELECT id, listing_url, products_found, new_products, failed_products,
            crawl_duration_seconds, status, error_message, timestamp
     FROM crawl_history
     ORDER BY timestamp DESC
     LIMIT ${lim}`,
  );
}

/**
 * Latest crawl timestamp per listing URL — used to show "last scraped" per
 * profile on the Profiles page. One row per distinct listing_url.
 * @returns {Promise<Array<{ listing_url: string, last_timestamp: string }>>}
 */
export async function getLastCrawlTimes() {
  return query(
    `SELECT listing_url, MAX(timestamp) AS last_timestamp
     FROM crawl_history
     GROUP BY listing_url`,
  );
}

/**
 * Fetch a single product row by its numeric id, with image arrays parsed and
 * raw_data decoded. Returns null when not found. Powers the products detail drawer.
 * @param {number} id
 * @returns {Promise<object|null>}
 */
export async function getProductById(id) {
  const rows = await query('SELECT * FROM products WHERE id = ? LIMIT 1', [id]);
  if (!rows.length) return null;
  const row = rows[0];
  row.scraped = !!row.scraped;
  row.is_active = !!row.is_active;
  row.images_local_paths = asArray(row.images_local_paths);
  row.images_remote_urls = asArray(row.images_remote_urls);
  if (typeof row.raw_data === 'string') {
    try {
      row.raw_data = JSON.parse(row.raw_data);
    } catch {
      /* leave as-is */
    }
  }
  return row;
}

export default {
  hasSeenProduct,
  getSeenUrls,
  getUnscrapedUrls,
  recordDiscoveredProduct,
  markProductScraped,
  upsertProduct,
  updateProductImages,
  recordProductError,
  getProductByUrl,
  setProductProfile,
  recordCrawl,
  addPendingMapping,
  listPendingMappings,
  updatePendingMappingFields,
  listRecentProducts,
  countProducts,
  countProductsByDomain,
  listCrawlHistory,
  getProductById,
};
