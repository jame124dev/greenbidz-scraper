/**
 * @file database/queries.js
 * @description All data-access operations for Product Monitor.
 *
 * Backed by Sequelize (see ../models). Straightforward reads use the models;
 * the subtle MySQL upserts (ON DUPLICATE KEY … with COALESCE / counter
 * increments) keep their exact SQL, executed over the same Sequelize
 * connection. Return shapes (snake_case keys, parsed JSON arrays, coerced
 * booleans) are preserved so nothing downstream changes.
 */

import path from 'node:path';
import { Op, QueryTypes, literal } from 'sequelize';
import {
  sequelize,
  Product,
  CrawlHistory,
  PendingMapping,
  CategoryMapping,
  SyncRun,
  SyncItem,
  SyncSettings,
} from '../models/index.js';
import { CONSTANTS } from '../config/constants.js';

/**
 * Convert stored absolute local image paths to URL paths served by the backend
 * under /downloads (e.g. /downloads/labassets.com/347/image_01.jpg). Paths
 * outside DOWNLOADS_DIR (e.g. from another machine) are dropped.
 */
function toLocalUrls(localPaths) {
  return asArray(localPaths)
    .map((p) => {
      try {
        const rel = path.relative(CONSTANTS.DOWNLOADS_DIR, String(p));
        if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
        return '/downloads/' + rel.split(path.sep).join('/');
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/** Run raw SELECT SQL with positional `?` params, returning rows. */
function selectSql(text, replacements = []) {
  return sequelize.query(text, { replacements, type: QueryTypes.SELECT });
}

/** Run raw write SQL (INSERT/UPDATE) with positional `?` params. */
function writeSql(text, replacements = []) {
  return sequelize.query(text, { replacements });
}

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

/**
 * Check whether a product URL already exists in products.
 * @param {string} productUrl
 * @returns {Promise<boolean>}
 */
export async function hasSeenProduct(productUrl) {
  const n = await Product.count({ where: { product_url: productUrl } });
  return n > 0;
}

/**
 * Fetch the full set of known product URLs (for brand-new detection).
 * @returns {Promise<Set<string>>}
 */
export async function getSeenUrls() {
  const rows = await Product.findAll({ attributes: ['product_url'], raw: true });
  return new Set(rows.map((r) => r.product_url));
}

/**
 * Fetch the set of product URLs that have NOT yet been scraped.
 * @returns {Promise<Set<string>>}
 */
export async function getUnscrapedUrls() {
  const rows = await Product.findAll({
    where: { scraped: false },
    attributes: ['product_url'],
    raw: true,
  });
  return new Set(rows.map((r) => r.product_url));
}

/**
 * Record a discovered product as a stub row (scraped = FALSE) if it does not
 * already exist. Existing rows are left untouched except for last_seen_at.
 * The owning profile (whose listing discovered it) is recorded so unscraped
 * stubs can be filtered by profile too; it never overwrites an existing value.
 * @param {string} productUrl
 * @param {string} [externalId]
 * @param {string} [profileFileName] - Owning profile's file name (optional).
 * @returns {Promise<void>}
 */
export async function recordDiscoveredProduct(productUrl, externalId = null, profileFileName = null) {
  await writeSql(
    `INSERT INTO products (external_id, product_url, raw_data, scraped, profile_file_name)
     VALUES (?, ?, ?, FALSE, ?)
     ON DUPLICATE KEY UPDATE
       last_seen_at      = CURRENT_TIMESTAMP,
       external_id       = COALESCE(VALUES(external_id), external_id),
       profile_file_name = COALESCE(profile_file_name, VALUES(profile_file_name))`,
    [
      externalId ?? (productUrl.split('/').filter(Boolean).pop() || productUrl),
      productUrl,
      JSON.stringify({}),
      profileFileName,
    ],
  );
}

/**
 * Explicitly flag a product as scraped.
 * @param {string} productUrl
 * @returns {Promise<void>}
 */
export async function markProductScraped(productUrl) {
  await Product.update(
    { scraped: true, scraped_at: literal('CURRENT_TIMESTAMP') },
    { where: { product_url: productUrl } },
  );
}

// ── products: full scrape persistence ────────────────────────────────────────

/**
 * Insert or update a product row (upsert on product_url).
 * @param {object} data
 * @returns {Promise<number|null>} The product id (existing or newly inserted).
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

  await writeSql(
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

  const row = await Product.findOne({
    where: { product_url: productUrl },
    attributes: ['id'],
    raw: true,
  });
  return row ? row.id : null;
}

/**
 * Update the locally-downloaded image paths for an existing product.
 * @param {number} productId
 * @param {string[]} localPaths
 * @returns {Promise<void>}
 */
export async function updateProductImages(productId, localPaths) {
  await Product.update({ images_local_paths: localPaths ?? [] }, { where: { id: productId } });
}

/**
 * Record a scrape failure against a product URL (creates a stub row if needed).
 * @param {string} productUrl
 * @param {string} errorMessage
 * @param {string} [profileFileName]
 * @returns {Promise<void>}
 */
export async function recordProductError(productUrl, errorMessage, profileFileName = null) {
  await writeSql(
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
  const row = await Product.findOne({ where: { product_url: productUrl }, raw: true });
  if (!row) return null;
  row.images_local_paths = asArray(row.images_local_paths);
  row.images_local_urls = toLocalUrls(row.images_local_paths);
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
  await writeSql(
    `INSERT INTO products (external_id, product_url, profile_file_name, raw_data)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE profile_file_name = VALUES(profile_file_name)`,
    [productUrl.split('/').pop() || productUrl, productUrl, profileFileName, JSON.stringify({})],
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
    scrapedProducts = 0,
    failedProducts = 0,
    durationSeconds = 0,
    status = 'completed',
    errorMessage = null,
  } = entry;

  const row = await CrawlHistory.create({
    listing_url: listingUrl,
    products_found: productsFound,
    new_products: newProducts,
    scraped_products: scrapedProducts,
    failed_products: failedProducts,
    crawl_duration_seconds: durationSeconds,
    status,
    error_message: errorMessage,
  });
  return row.id;
}

// ── pending_mappings ──────────────────────────────────────────────────────────

/**
 * Insert a pending mapping for review when no profile matches a URL pattern.
 * Idempotent on url_pattern.
 * @param {object} entry
 * @returns {Promise<void>}
 */
export async function addPendingMapping({ urlPattern, sampleUrl, autoDetectedFields = null }) {
  await writeSql(
    `INSERT INTO pending_mappings (url_pattern, sample_url, auto_detected_fields, status)
     VALUES (?, ?, ?, 'pending')
     ON DUPLICATE KEY UPDATE sample_url = VALUES(sample_url)`,
    [urlPattern, sampleUrl, autoDetectedFields ? JSON.stringify(autoDetectedFields) : null],
  );
}

/**
 * List pending mappings (optionally filtered by status).
 * @param {string} [status='pending']
 * @returns {Promise<object[]>}
 */
export async function listPendingMappings(status = 'pending') {
  return PendingMapping.findAll({
    where: { status },
    order: [['created_at', 'DESC']],
    raw: true,
  });
}

/**
 * Refresh the auto-detected fields stored against a pending mapping.
 * @param {number} id
 * @param {object} autoDetectedFields
 * @returns {Promise<void>}
 */
export async function updatePendingMappingFields(id, autoDetectedFields) {
  await PendingMapping.update(
    { auto_detected_fields: autoDetectedFields ?? {} },
    { where: { id } },
  );
}

// ── read helpers (for the web UI / reporting) ────────────────────────────────

/**
 * List products (newest first) with server-side pagination + filtering, so the
 * UI can page through the ENTIRE table.
 * @param {object} [opts]
 * @param {number} [opts.limit=50]
 * @param {number} [opts.offset=0]
 * @param {'all'|'scraped'|'unscraped'} [opts.status='all']
 * @param {boolean} [opts.scrapedOnly] - legacy alias for status='scraped'
 * @param {string} [opts.profile] - filter by profile_file_name
 * @param {string} [opts.search] - matches title / product_url / external_id
 * @returns {Promise<{ products: object[], total: number }>}
 */
export async function listRecentProducts({
  limit = 50,
  offset = 0,
  status = 'all',
  scrapedOnly = false,
  profile,
  search,
} = {}) {
  const lim = Math.max(1, Math.min(500, Number(limit) || 50));
  const off = Math.max(0, Number(offset) || 0);

  const where = {};
  const st = scrapedOnly ? 'scraped' : status;
  if (st === 'scraped') where.scraped = true;
  else if (st === 'unscraped') where.scraped = false;
  else if (st === 'incomplete') {
    // Scraped but missing core data (no title, no price, or no images) — these
    // are the candidates for a rescrape.
    where.scraped = true;
    where[Op.and] = [
      literal(
        "(title IS NULL OR title = '' OR price IS NULL " +
          "OR images_remote_urls IS NULL OR JSON_LENGTH(images_remote_urls) = 0)",
      ),
    ];
  }
  if (profile) where.profile_file_name = profile;
  const q = String(search || '').trim();
  if (q) {
    where[Op.or] = [
      { title: { [Op.like]: `%${q}%` } },
      { product_url: { [Op.like]: `%${q}%` } },
      { external_id: { [Op.like]: `%${q}%` } },
    ];
  }

  const { rows, count } = await Product.findAndCountAll({
    attributes: [
      'id', 'external_id', 'product_url', 'profile_file_name', 'title', 'price',
      'scraped', 'scraped_at', 'first_seen_at', 'last_seen_at', 'is_active',
      'images_local_paths', 'images_remote_urls', 'last_error',
      'synced_at', 'main_product_id',
    ],
    where,
    order: [['last_seen_at', 'DESC']],
    limit: lim,
    offset: off,
    raw: true,
  });

  const products = rows.map((r) => ({
    ...r,
    scraped: !!r.scraped,
    is_active: !!r.is_active,
    synced: !!r.synced_at,
    images_local_paths: asArray(r.images_local_paths),
    images_local_urls: toLocalUrls(r.images_local_paths),
    images_remote_urls: asArray(r.images_remote_urls),
  }));
  return { products, total: count };
}

/**
 * Delete products by id (e.g. removing a listing from the scraper DB).
 * @param {number[]} ids
 * @returns {Promise<number>} rows deleted
 */
export async function deleteProducts(ids) {
  const clean = (Array.isArray(ids) ? ids : []).map(Number).filter((n) => Number.isInteger(n));
  if (!clean.length) return 0;
  return Product.destroy({ where: { id: { [Op.in]: clean } } });
}

// ── category mappings (source category → main-site category) ──────────────────

/**
 * Distinct scraped (category, subcategory) values from products' raw_data,
 * optionally scoped to a profile or a set of product ids.
 * @returns {Promise<Array<{ category: string, subcategory: string }>>}
 */
export async function getDistinctSourceCategories({ profile, productIds } = {}) {
  // Resolve the profile(s) to show ALL of a profile's scraped categories (not
  // just the selected products). If productIds are given, expand to their
  // distinct profile_file_name(s).
  let profiles = profile ? [profile] : null;
  const ids = (Array.isArray(productIds) ? productIds : []).map(Number).filter((n) => Number.isInteger(n));
  if (!profiles && ids.length) {
    const prows = await sequelize.query(
      'SELECT DISTINCT profile_file_name AS p FROM products WHERE id IN (:ids) AND profile_file_name IS NOT NULL',
      { replacements: { ids }, type: QueryTypes.SELECT },
    );
    profiles = prows.map((r) => r.p).filter(Boolean);
  }

  const conds = ["JSON_EXTRACT(raw_data, '$.category') IS NOT NULL"];
  const repl = {};
  if (profiles && profiles.length) {
    conds.push('profile_file_name IN (:profiles)');
    repl.profiles = profiles;
  } else if (ids.length) {
    conds.push('id IN (:ids)');
    repl.ids = ids;
  }
  const rows = await sequelize.query(
    `SELECT DISTINCT
       JSON_UNQUOTE(JSON_EXTRACT(raw_data, '$.category')) AS category,
       COALESCE(JSON_UNQUOTE(JSON_EXTRACT(raw_data, '$.subcategory')), '') AS subcategory
     FROM products
     WHERE ${conds.join(' AND ')}
     ORDER BY category, subcategory`,
    { replacements: repl, type: QueryTypes.SELECT },
  );
  return rows
    .map((r) => ({
      category: r.category,
      subcategory: r.subcategory === 'null' || r.subcategory == null ? '' : r.subcategory,
    }))
    .filter((r) => r.category && r.category !== 'null');
}

/** List saved category mappings for a site_type. */
export async function listCategoryMappings(siteType) {
  return CategoryMapping.findAll({ where: { site_type: siteType }, raw: true });
}

/**
 * Upsert category mappings for a site_type.
 * @param {string} siteType
 * @param {Array<{source_category, source_subcategory?, main_term_id, main_term_name?}>} mappings
 * @returns {Promise<number>} rows written
 */
export async function saveCategoryMappings(siteType, mappings) {
  const rows = (Array.isArray(mappings) ? mappings : [])
    .filter((m) => m && m.source_category && m.main_term_id)
    .map((m) => ({
      site_type: siteType,
      source_category: String(m.source_category),
      source_subcategory: m.source_subcategory ? String(m.source_subcategory) : '',
      main_term_id: Number(m.main_term_id),
      main_term_name: m.main_term_name ? String(m.main_term_name) : null,
      updated_at: new Date(),
    }));
  if (!rows.length) return 0;
  await CategoryMapping.bulkCreate(rows, {
    updateOnDuplicate: ['main_term_id', 'main_term_name', 'updated_at'],
  });
  return rows.length;
}

/**
 * Mark products as synced to the main site (sets synced_at = now). Optionally
 * stores the main-site product id when a 1:1 mapping is known.
 * @param {number[]} ids
 * @returns {Promise<number>} rows updated
 */
export async function markProductsSynced(ids, mainIdByProductId = {}) {
  const clean = (Array.isArray(ids) ? ids : []).map(Number).filter((n) => Number.isInteger(n));
  if (!clean.length) return 0;
  const [count] = await Product.update(
    { synced_at: literal('CURRENT_TIMESTAMP') },
    { where: { id: { [Op.in]: clean } } },
  );
  // Store the main-site product id where the response provided a mapping.
  for (const id of clean) {
    const mid = mainIdByProductId[id];
    if (mid != null) {
      // eslint-disable-next-line no-await-in-loop
      await Product.update({ main_product_id: Number(mid) }, { where: { id } });
    }
  }
  return count;
}

/**
 * Count products grouped by scraped flag.
 * @returns {Promise<{ total: number, scraped: number, unscraped: number }>}
 */
export async function countProducts() {
  const rows = await selectSql(
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
 * @param {string} domain
 * @returns {Promise<number>}
 */
export async function countProductsByDomain(domain) {
  if (!domain) return 0;
  return Product.count({ where: { product_url: { [Op.like]: `%://${domain}/%` } } });
}

/**
 * List recent crawl-history runs, newest first.
 * @param {object} [opts]
 * @returns {Promise<object[]>}
 */
export async function listCrawlHistory({ limit = 100 } = {}) {
  const lim = Math.max(1, Math.min(500, Number(limit) || 100));
  return CrawlHistory.findAll({
    attributes: [
      'id', 'listing_url', 'products_found', 'new_products', 'scraped_products', 'failed_products',
      'crawl_duration_seconds', 'status', 'error_message', 'timestamp',
    ],
    order: [['timestamp', 'DESC']],
    limit: lim,
    raw: true,
  });
}

/**
 * Latest crawl timestamp per listing URL — used to show "last scraped" per
 * profile on the Profiles page.
 * @returns {Promise<Array<{ listing_url: string, last_timestamp: string }>>}
 */
export async function getLastCrawlTimes() {
  return selectSql(
    `SELECT listing_url, MAX(timestamp) AS last_timestamp
     FROM crawl_history
     GROUP BY listing_url`,
  );
}

/**
 * Fetch a single product row by its numeric id, with image arrays parsed and
 * raw_data decoded. Returns null when not found.
 * @param {number} id
 * @returns {Promise<object|null>}
 */
export async function getProductById(id) {
  const row = await Product.findByPk(id, { raw: true });
  if (!row) return null;
  row.scraped = !!row.scraped;
  row.is_active = !!row.is_active;
  row.images_local_paths = asArray(row.images_local_paths);
  row.images_local_urls = toLocalUrls(row.images_local_paths);
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

// ── Sync runs / items / settings ────────────────────────────────────────────

/**
 * Resolve which product ids to include in a sync run from filter conditions.
 * Mirrors listRecentProducts' Sequelize Op usage. Only scraped products are
 * eligible. Returns ids in the chosen order, plus the unclamped match total.
 *
 * @param {object} [opts]
 * @param {string} [opts.profile]        - profile_file_name to scope to.
 * @param {number} [opts.priceMin]       - inclusive lower price bound.
 * @param {number} [opts.priceMax]       - inclusive upper price bound.
 * @param {string} [opts.titleContains]  - case-insensitive title substring.
 * @param {boolean} [opts.onlyUnsynced]  - exclude already-synced (default true).
 * @param {boolean} [opts.latestOnly]    - order by scraped_at DESC (newest first).
 * @param {number} [opts.limit]          - cap ids returned this run.
 * @returns {Promise<{ ids: number[], total: number }>}
 */
export async function selectProductsForSync({
  profile,
  priceMin,
  priceMax,
  titleContains,
  onlyUnsynced = true,
  latestOnly = false,
  limit = 100,
} = {}) {
  const lim = Math.max(1, Math.min(500, Number(limit) || 100));
  const where = { scraped: true };
  if (profile) where.profile_file_name = profile;
  if (onlyUnsynced) where.synced_at = { [Op.is]: null };

  const priceClause = {};
  if (priceMin != null && priceMin !== '' && !Number.isNaN(Number(priceMin))) {
    priceClause[Op.gte] = Number(priceMin);
  }
  if (priceMax != null && priceMax !== '' && !Number.isNaN(Number(priceMax))) {
    priceClause[Op.lte] = Number(priceMax);
  }
  if (Object.getOwnPropertySymbols(priceClause).length) where.price = priceClause;

  const q = String(titleContains || '').trim();
  if (q) where.title = { [Op.like]: `%${q}%` };

  const total = await Product.count({ where });
  const rows = await Product.findAll({
    attributes: ['id'],
    where,
    order: [[latestOnly ? 'scraped_at' : 'last_seen_at', 'DESC']],
    limit: lim,
    raw: true,
  });
  return { ids: rows.map((r) => r.id), total };
}

/**
 * Distinct main-site categories that have at least one saved source mapping.
 * When `profile` is given, only the main categories reachable from THAT
 * profile's scraped product categories (raw_data.category) are returned.
 * @param {string} [profile] - profile_file_name to scope to.
 */
export async function listMappedMainCategories(profile) {
  if (!profile) {
    return selectSql(
      `SELECT main_term_id, MAX(main_term_name) AS main_term_name
       FROM category_mappings
       GROUP BY main_term_id
       ORDER BY main_term_name`,
    );
  }
  return selectSql(
    `SELECT cm.main_term_id, MAX(cm.main_term_name) AS main_term_name
     FROM category_mappings cm
     WHERE cm.source_category IN (
       SELECT DISTINCT JSON_UNQUOTE(JSON_EXTRACT(p.raw_data, '$.category'))
       FROM products p
       WHERE p.profile_file_name = ?
         AND JSON_EXTRACT(p.raw_data, '$.category') IS NOT NULL
     )
     GROUP BY cm.main_term_id
     ORDER BY main_term_name`,
    [profile],
  );
}

/**
 * Build the Sequelize `where` for sync candidate filters. Returns null when the
 * mainCategory filter resolves to no source categories (i.e. zero matches).
 * @returns {Promise<object|null>}
 */
async function buildSyncCandidateWhere({ profile, priceMin, priceMax, titleContains, onlyUnsynced = true, mainCategory } = {}) {
  const where = { scraped: true };
  if (profile) where.profile_file_name = profile;
  if (onlyUnsynced) where.synced_at = { [Op.is]: null };

  const price = {};
  if (priceMin != null && priceMin !== '' && !Number.isNaN(Number(priceMin))) price[Op.gte] = Number(priceMin);
  if (priceMax != null && priceMax !== '' && !Number.isNaN(Number(priceMax))) price[Op.lte] = Number(priceMax);
  if (Object.getOwnPropertySymbols(price).length) where.price = price;

  const q = String(titleContains || '').trim();
  if (q) where.title = { [Op.like]: `%${q}%` };

  // Main-category filter: include products whose scraped category is mapped to it.
  if (mainCategory != null && mainCategory !== '') {
    const maps = await CategoryMapping.findAll({
      where: { main_term_id: Number(mainCategory) },
      attributes: ['source_category'],
      raw: true,
    });
    const cats = [...new Set(maps.map((m) => m.source_category).filter(Boolean))];
    if (!cats.length) return null;
    const inList = cats.map((c) => sequelize.escape(c)).join(', ');
    where[Op.and] = [literal(`JSON_UNQUOTE(JSON_EXTRACT(raw_data, '$.category')) IN (${inList})`)];
  }
  return where;
}

/**
 * All matching product ids for the sync filters (no pagination). Used by the
 * "select all matches" action. Capped by `limit` (null = All, hard-capped).
 * @returns {Promise<{ ids: number[], total: number }>}
 */
export async function listSyncCandidateIds({
  profile, priceMin, priceMax, titleContains, onlyUnsynced = true, latestOnly = false, mainCategory, limit = null,
} = {}) {
  const where = await buildSyncCandidateWhere({ profile, priceMin, priceMax, titleContains, onlyUnsynced, mainCategory });
  if (!where) return { ids: [], total: 0 };
  const matchCount = await Product.count({ where });
  const cap = limit ? Math.max(0, Number(limit)) : 5000; // safety cap for "All"
  const rows = await Product.findAll({
    attributes: ['id'],
    where,
    order: [[latestOnly ? 'scraped_at' : 'last_seen_at', 'DESC']],
    limit: cap,
    raw: true,
  });
  return { ids: rows.map((r) => r.id), total: Math.min(matchCount, cap) };
}

/**
 * Full product rows matching the sync filters, paginated. Same row shape as
 * listRecentProducts. `mainCategory` (a mapped main_term_id) restricts to
 * products whose scraped category maps to it. `limit` caps the candidate pool
 * (null = All matching); `offset`/`pageSize` page within that pool.
 *
 * @returns {Promise<{ products: object[], total: number }>}
 */
export async function listSyncCandidates({
  profile,
  priceMin,
  priceMax,
  titleContains,
  onlyUnsynced = true,
  latestOnly = false,
  mainCategory,
  limit = null,
  offset = 0,
  pageSize = 50,
} = {}) {
  const where = await buildSyncCandidateWhere({ profile, priceMin, priceMax, titleContains, onlyUnsynced, mainCategory });
  if (!where) return { products: [], total: 0 };

  const matchCount = await Product.count({ where });
  const total = limit ? Math.min(matchCount, Math.max(0, Number(limit))) : matchCount;
  const off = Math.max(0, Number(offset) || 0);
  const take = Math.max(0, Math.min(Number(pageSize) || 50, total - off));

  let rows = [];
  if (take > 0) {
    rows = await Product.findAll({
      attributes: [
        'id', 'external_id', 'product_url', 'profile_file_name', 'title', 'price',
        'scraped', 'scraped_at', 'first_seen_at', 'last_seen_at', 'is_active',
        'images_local_paths', 'images_remote_urls', 'last_error', 'synced_at', 'main_product_id',
      ],
      where,
      order: [[latestOnly ? 'scraped_at' : 'last_seen_at', 'DESC']],
      limit: take,
      offset: off,
      raw: true,
    });
  }

  const products = rows.map((r) => ({
    ...r,
    scraped: !!r.scraped,
    is_active: !!r.is_active,
    synced: !!r.synced_at,
    images_local_paths: asArray(r.images_local_paths),
    images_local_urls: toLocalUrls(r.images_local_paths),
    images_remote_urls: asArray(r.images_remote_urls),
  }));
  return { products, total };
}

/** Create a sync_run row. Returns the created row (plain object). */
export async function createSyncRun(fields) {
  const row = await SyncRun.create(fields);
  return row.get({ plain: true });
}

/** Patch a sync_run row by id. */
export async function updateSyncRun(id, patch) {
  await SyncRun.update(patch, { where: { id } });
}

/** Bulk-insert sync_item rows. */
export async function addSyncItems(rows) {
  if (!Array.isArray(rows) || !rows.length) return 0;
  const created = await SyncItem.bulkCreate(rows);
  return created.length;
}

/**
 * List sync runs, newest/oldest first, optionally filtered. Paginated.
 * @param {object} [opts] - { profile, status, order: 'asc'|'desc', limit, offset }
 * @returns {Promise<{ runs: object[], total: number }>}
 */
export async function listSyncRuns({ profile, status, order = 'desc', limit = 50, offset = 0 } = {}) {
  const lim = Math.max(1, Math.min(200, Number(limit) || 50));
  const off = Math.max(0, Number(offset) || 0);
  const where = {};
  if (profile) where.profile = profile;
  if (status && status !== 'all') where.status = status;
  const dir = String(order).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const { rows, count } = await SyncRun.findAndCountAll({
    where,
    order: [['created_at', dir]],
    limit: lim,
    offset: off,
    raw: true,
  });
  return { runs: rows, total: count };
}

/** A single sync run with its per-product items. */
export async function getSyncRunWithItems(id) {
  const run = await SyncRun.findByPk(id, { raw: true });
  if (!run) return null;
  const items = await SyncItem.findAll({
    where: { sync_run_id: id },
    order: [['id', 'ASC']],
    raw: true,
  });
  return { run, items };
}

/** Currently-processing sync runs (durable source of truth for "active"). */
export async function listActiveSyncRuns() {
  return SyncRun.findAll({ where: { status: 'processing' }, order: [['created_at', 'DESC']], raw: true });
}

/** Product ids that failed in a given run (for resync). */
export async function getFailedProductIds(runId) {
  const rows = await SyncItem.findAll({
    where: { sync_run_id: runId, status: 'failed' },
    attributes: ['product_id'],
    raw: true,
  });
  return rows.map((r) => r.product_id);
}

/** Read the single sync-settings config row ({} when unset). */
export async function getSyncSettings() {
  const row = await SyncSettings.findOne({ order: [['id', 'ASC']], raw: true });
  return row?.config_json ?? {};
}

/** Upsert the single sync-settings config row. */
export async function saveSyncSettings(config) {
  const existing = await SyncSettings.findOne({ order: [['id', 'ASC']] });
  if (existing) {
    await existing.update({ config_json: config, updated_at: literal('CURRENT_TIMESTAMP') });
  } else {
    await SyncSettings.create({ config_json: config });
  }
  return config;
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
  deleteProducts,
  markProductsSynced,
  getDistinctSourceCategories,
  listCategoryMappings,
  saveCategoryMappings,
  countProducts,
  countProductsByDomain,
  listCrawlHistory,
  getProductById,
  selectProductsForSync,
  listMappedMainCategories,
  listSyncCandidates,
  listSyncCandidateIds,
  createSyncRun,
  updateSyncRun,
  addSyncItems,
  listSyncRuns,
  getSyncRunWithItems,
  listActiveSyncRuns,
  getFailedProductIds,
  getSyncSettings,
  saveSyncSettings,
};
