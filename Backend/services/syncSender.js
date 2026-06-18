/**
 * @file services/syncSender.js
 * @description The main-site create-grouped-listings POST, extracted from
 * sync.controller.submitSync so both the synchronous endpoint and the
 * background sync-job runner share identical request mechanics. Behavior is
 * unchanged from the original inline implementation.
 */
import { logger } from '../utils/logger.js';
import { SYNC_DEFAULTS } from '../config/sync-config.js';

const MAIN_API_BASE_URL = process.env.MAIN_API_BASE_URL || 'https://api.101recycle.greenbidz.com';
const MAIN_API_SYSTEM_KEY = process.env.MAIN_API_SYSTEM_KEY || '';

/** Whether the backend is configured to talk to the main API. */
export function hasSystemKey() {
  return !!MAIN_API_SYSTEM_KEY;
}

/**
 * POST a set of mapped products to the main site's create-grouped-listings API.
 *
 * @param {object} args
 * @param {string} args.siteType - x-platform value.
 * @param {object[]} args.results - mapProduct() results (each has .mapped, .images, .productId).
 * @param {string} args.country
 * @param {{ id: number }} args.seller
 * @returns {Promise<{
 *   ok: boolean, status: number, data: any,
 *   mainIdByProductId: Record<number, number>,
 *   mainBatchByProductId: Record<number, number>, error?: string
 * }>}
 *   ok=false with error set on network failure (status 0) or upstream non-2xx.
 */
export async function postGroupedListings({ siteType, results, country, seller }) {
  const productsJson = results.map((r) => r.mapped);
  const imageUrlsJson = results.map((r) => r.images);

  const fd = new FormData();
  fd.append('products_json', JSON.stringify(productsJson));
  fd.append('auction_group_json', JSON.stringify({ country }));
  fd.append('seller_id', String(seller.id));
  fd.append('country', country);
  fd.append('visibility', SYNC_DEFAULTS.visibility);
  fd.append('from_agent', String(SYNC_DEFAULTS.from_agent));
  fd.append('image_urls_json', JSON.stringify(imageUrlsJson));

  const url = `${MAIN_API_BASE_URL}/api/v1/wp/create-grouped-listings?lang=en`;
  logger.info(`↗️  Syncing ${productsJson.length} product(s) to main site (${siteType})`);

  let upstream;
  try {
    upstream = await fetch(url, {
      method: 'POST',
      headers: { 'x-system-key': MAIN_API_SYSTEM_KEY, 'x-platform': siteType },
      body: fd,
    });
  } catch (err) {
    logger.error(`Main API request failed: ${err.message}`);
    return { ok: false, status: 0, data: null, mainIdByProductId: {}, error: `Could not reach main API: ${err.message}` };
  }

  const text = await upstream.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!upstream.ok) {
    logger.warn(`Main API returned ${upstream.status}`);
    return {
      ok: false,
      status: upstream.status,
      data,
      mainIdByProductId: {},
      error: 'Main API rejected the sync.',
    };
  }

  // Map main-site product ids + batch ids back to ours via the response's `index`.
  const mainIdByProductId = {};
  const mainBatchByProductId = {};
  const created = data?.data?.products;
  if (Array.isArray(created)) {
    for (const p of created) {
      const ours = results[p.index]?.productId;
      if (ours == null) continue;
      if (p.product_id != null) mainIdByProductId[ours] = p.product_id;
      if (p.batch_id != null) mainBatchByProductId[ours] = p.batch_id;
    }
  }

  return { ok: true, status: upstream.status, data, mainIdByProductId, mainBatchByProductId };
}

/**
 * Translate a create-grouped-listings `mapped` entry into the body the main
 * site's admin product-update endpoint expects (PATCH /api/v1/admin/product/:id).
 * Only fields the admin controller understands are forwarded; absent values are
 * left out so the PATCH never clobbers a field with an empty string.
 */
function mappedToAdminPatch(mapped) {
  const body = {};
  if (mapped.product_title != null) body.title = mapped.product_title;
  if (mapped.product_content != null) body.description = mapped.product_content;
  if (mapped.price_per_unit !== undefined && mapped.price_per_unit !== '') body.price_per_unit = mapped.price_per_unit;
  if (mapped.price_format != null) body.price_format = mapped.price_format;
  if (mapped.price_currency != null) body.price_currency = mapped.price_currency;
  if (mapped.price_now_enabled != null) body.price_now_enabled = mapped.price_now_enabled;
  if (mapped.quantity != null) body.quantity = mapped.quantity;
  if (mapped.product_category_ids) {
    body.category_id = mapped.product_category_ids;
    body.category_name = mapped.category_name || '';
  }
  // item_condition / operation_status are arrays in `mapped`; the admin
  // controller serializes a single string value into the WP meta itself.
  const cond = Array.isArray(mapped.item_condition) ? mapped.item_condition[0] : mapped.item_condition;
  if (cond) body.condition = cond;
  const op = Array.isArray(mapped.operation_status) ? mapped.operation_status[0] : mapped.operation_status;
  if (op) body.operation_status = op;
  if (mapped.item_grade) body.grade = mapped.item_grade;
  if (mapped.brand) body.brand = mapped.brand;
  if (mapped.scrape_meta != null) body.scrape_meta = mapped.scrape_meta;
  if (mapped.is_scraped != null) body.is_scraped = mapped.is_scraped;
  return body;
}

/**
 * PATCH an existing main-site product (a resync/update) via the admin listing
 * editor. Reuses the same x-system-key the create flow uses. Images are NOT
 * touched here — field updates only.
 *
 * @param {object} args
 * @param {number} args.mainProductId - the main-site product id stored on a prior sync.
 * @param {object} args.mapped        - a mapProduct() `.mapped` entry.
 * @param {string} args.siteType      - x-platform value (for parity with the create call).
 * @returns {Promise<{ ok: boolean, status: number, data: any, error?: string }>}
 */
export async function patchMainProduct({ mainProductId, mapped, siteType }) {
  const body = mappedToAdminPatch(mapped);
  const url = `${MAIN_API_BASE_URL}/api/v1/admin/product/${mainProductId}`;
  logger.info(`♻️  Updating main-site product #${mainProductId} (${siteType})`);

  let upstream;
  try {
    upstream = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-system-key': MAIN_API_SYSTEM_KEY,
        'x-platform': siteType,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    logger.error(`Main API update failed: ${err.message}`);
    return { ok: false, status: 0, data: null, error: `Could not reach main API: ${err.message}` };
  }

  const text = await upstream.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!upstream.ok || data?.success === false) {
    logger.warn(`Main API update returned ${upstream.status} for #${mainProductId}`);
    return {
      ok: false,
      status: upstream.status,
      data,
      error: data?.message || `Main API rejected the update (HTTP ${upstream.status}).`,
    };
  }

  return { ok: true, status: upstream.status, data };
}

export default { postGroupedListings, patchMainProduct, hasSystemKey };
