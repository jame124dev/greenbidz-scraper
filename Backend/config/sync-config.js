/**
 * @file config/sync-config.js
 * @description Static configuration for syncing scraped products to the main
 * GreenBidz site (create-grouped-listings). v1: categories come from a static
 * file (marketplaces.json), seller is picked from a hard-coded list (login/admin
 * panel later), and unset fields get sensible defaults the admin can override.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Full marketplace → category/subcategory tree (real WP term IDs). */
export const MARKETPLACES = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'marketplaces.json'), 'utf8'),
).marketplaces;

/**
 * marketplaces.json `name` → the site_type/allowed_sites value the main API
 * expects (see normalizeMarketplaceType in createProductV2). Also used as the
 * x-platform header.
 */
export const SITE_TYPE_BY_MARKETPLACE = {
  '101lab': 'LabGreenbidz',
  '101machine': 'machines',
  '101it': '101it',
  '101recycle': 'recycle',
};

/** Sellers the admin can pick from (login/admin-panel wiring comes later). */
export const SELLERS = [
  {
    id: 959,
    username: 'troupreixouveffei-8758',
    email: 'troupreixouveffei-8758@yopmail.com',
    displayName: 'First Last Name',
  },
];

/** Defaults for fields not present in scraped data (admin can override). */
export const SYNC_DEFAULTS = {
  product_type: 'simple',
  price_format: 'buyNow',
  price_currency: 'USD',
  quantity: '1',
  operation_status: ['deinstalled'],
  visibility: 'PUBLIC',
  sellerVisible: 'true',
  steps: '1',
  from_agent: true,
  price_now_enabled: '1',
  is_scraped: true,
};

/** Selectable option sets (extend as the main site adds values). */
export const ENUMS = {
  product_type: ['simple', 'auction'],
  price_format: ['buyNow', 'auction'],
  price_currency: ['USD', 'EUR', 'THB', 'GBP', 'JPY', 'CNY', 'INR'],
  // Only two selectable conditions on the sync UI. Values are the main API's
  // codes; the UI shows friendly labels (new → "New", usedFunctional → "Used").
  item_condition: ['new', 'usedFunctional'],
  item_grade: ['A', 'B', 'C', 'D'],
  operation_status: ['deinstalled', 'installed', 'running'],
  visibility: ['PUBLIC', 'PRIVATE'],
};

/** Fields that block a sync if empty (per product). */
export const REQUIRED_FIELDS = ['category', 'price'];

/**
 * Main-site target fields the admin can manually re-route to a different scraped
 * SOURCE field (Field Mappings UI). `defaultSource` documents the scraped field
 * the internal mapper uses by default (shown as a hint); leaving a target
 * unmapped keeps that automatic behavior. `enum` names an ENUMS key when the
 * value is constrained. Category is intentionally excluded — it has its own
 * mapping flow (category_mappings).
 */
export const TARGET_FIELDS = [
  { key: 'product_title', label: 'Title', defaultSource: 'title' },
  { key: 'product_content', label: 'Description', defaultSource: 'description' },
  { key: 'price_per_unit', label: 'Price / unit', defaultSource: 'price' },
  { key: 'price_currency', label: 'Currency', enum: 'price_currency' },
  { key: 'quantity', label: 'Quantity', defaultSource: 'quantity' },
  { key: 'item_condition', label: 'Condition', enum: 'item_condition', defaultSource: 'condition' },
  { key: 'item_grade', label: 'Grade', enum: 'item_grade' },
  { key: 'operation_status', label: 'Operation status', enum: 'operation_status' },
  { key: 'country', label: 'Country' },
  { key: 'location', label: 'Location' },
  { key: 'weight_per_unit', label: 'Weight / unit', defaultSource: 'spec:Weight' },
  { key: 'replacement_cost_per_unit', label: 'Replacement cost / unit' },
  { key: 'brand', label: 'Brand', defaultSource: 'spec:Manufacturer' },
  { key: 'model', label: 'Model', defaultSource: 'spec:Model' },
  { key: 'serial_number', label: 'Serial number', defaultSource: 'spec:Serial' },
  { key: 'dimensions', label: 'Dimensions', defaultSource: 'spec:Dimensions' },
  { key: 'market_metrics', label: 'Market metrics' },
  { key: 'price_format', label: 'Price format', enum: 'price_format' },
  { key: 'product_type', label: 'Product type', enum: 'product_type' },
];

/** Set of valid target-field keys, for validating incoming field mappings. */
export const TARGET_FIELD_KEYS = new Set(TARGET_FIELDS.map((f) => f.key));

/** Fixed (always-present) scraped source fields, independent of profile. */
export const STANDARD_SOURCE_FIELDS = [
  { key: 'title', label: 'Title (scraped)' },
  { key: 'description', label: 'Description (scraped)' },
  { key: 'price', label: 'Price (scraped)' },
  { key: 'category', label: 'Category (scraped)' },
  { key: 'subcategory', label: 'Subcategory (scraped)' },
  { key: 'quantity', label: 'Quantity (scraped)' },
  { key: 'condition', label: 'Condition (scraped)' },
];

/** Resolve a marketplace by its name OR by its site_type value. */
export function getMarketplace(key) {
  if (!key) return null;
  return (
    MARKETPLACES.find((m) => m.name === key) ||
    MARKETPLACES.find((m) => SITE_TYPE_BY_MARKETPLACE[m.name] === key) ||
    null
  );
}

/** site_type/allowed_sites value for a marketplace name (or pass-through). */
export function siteTypeFor(key) {
  return SITE_TYPE_BY_MARKETPLACE[key] || key;
}

/**
 * Public storefront host per site_type (matches the main backend's OG
 * SITE_BRANDS). Override the whole map with MAIN_SITE_HOSTS_JSON in .env.
 */
export const MAIN_SITE_HOSTS = (() => {
  const defaults = {
    LabGreenbidz: '101lab.co',
    machines: '101machines.com',
    '101it': '101it.co',
    recycle: '101recycle.greenbidz.com',
  };
  try {
    if (process.env.MAIN_SITE_HOSTS_JSON) {
      return { ...defaults, ...JSON.parse(process.env.MAIN_SITE_HOSTS_JSON) };
    }
  } catch {
    /* malformed override — fall back to defaults */
  }
  return defaults;
})();

/**
 * Public listing URL for a synced product: the storefront page keyed by the
 * main-site BATCH id. Returns null when we lack the batch id or a known host.
 * @param {string} siteType
 * @param {number} batchId
 */
export function mainListingUrl(siteType, batchId) {
  if (batchId == null) return null;
  const host = MAIN_SITE_HOSTS[siteType];
  if (!host) return null;
  return `https://${host}/buyer-marketplace/${batchId}`;
}

/** Flatten a marketplace's categories + subcategories into a lookup list. */
export function flattenCategories(marketplace) {
  const out = [];
  for (const c of marketplace?.categories || []) {
    out.push({ term_id: c.id, name: c.name, slug: c.slug, parent: null, isSub: false });
    for (const s of c.subcategories || []) {
      out.push({
        term_id: s.id,
        name: s.name,
        slug: s.slug,
        parent: c.id,
        parentName: c.name,
        isSub: true,
      });
    }
  }
  return out;
}

/**
 * Best-effort category match: score each category/subcategory by how many of
 * its significant name-words appear in the given text (product title/desc).
 * Prefers subcategories on ties. Returns null when nothing matches.
 * @param {object} marketplace
 * @param {string} text
 */
export function matchCategory(marketplace, text) {
  const flat = flattenCategories(marketplace);
  const hay = String(text || '').toLowerCase();
  if (!hay) return null;
  let best = null;
  let bestScore = 0;
  for (const cat of flat) {
    const words = cat.name
      .toLowerCase()
      .replace(/\(.*?\)/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter((w) => w.length > 3);
    if (!words.length) continue;
    const score = words.reduce((s, w) => s + (hay.includes(w) ? 1 : 0), 0);
    if (score > bestScore || (score === bestScore && score > 0 && cat.isSub && best && !best.isSub)) {
      best = cat;
      bestScore = score;
    }
  }
  return bestScore > 0 ? best : null;
}

export default {
  MARKETPLACES,
  SITE_TYPE_BY_MARKETPLACE,
  SELLERS,
  SYNC_DEFAULTS,
  ENUMS,
  REQUIRED_FIELDS,
  TARGET_FIELDS,
  TARGET_FIELD_KEYS,
  STANDARD_SOURCE_FIELDS,
  MAIN_SITE_HOSTS,
  getMarketplace,
  siteTypeFor,
  mainListingUrl,
  flattenCategories,
  matchCategory,
};
