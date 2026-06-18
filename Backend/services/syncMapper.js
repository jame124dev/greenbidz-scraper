/**
 * @file services/syncMapper.js
 * @description Map a scraped product (+ admin overrides + batch prereqs) into a
 * single `products_json` entry for the main site's create-grouped-listings API.
 * Also resolves the category (override id → auto-match by title) and reports
 * which required fields are still missing.
 */
import {
  getMarketplace,
  siteTypeFor,
  flattenCategories,
  matchCategory,
  SYNC_DEFAULTS,
} from '../config/sync-config.js';
import { htmlToText } from '../utils/html.js';
import {
  simplifyQuantity,
  normalizeCondition,
  parseWeight,
  findSpec,
  cleanText,
} from './normalize.js';

/** Coerce a value to a clean array (the main API expects arrays for these). */
function toArr(v) {
  if (v == null || v === '') return [];
  return (Array.isArray(v) ? v : [v]).filter((x) => x != null && x !== '');
}

/**
 * Resolve a saved field-mapping SOURCE key to its scraped value for a product.
 * Encoding: 'title'|'description'|'price' (product columns);
 * 'category'|'subcategory'|'quantity'|'condition' or 'raw:<key>' (raw_data);
 * 'spec:<Label>' (raw_data.specifications[Label]). Returns undefined when the
 * key resolves to nothing, so callers can fall back to the default behavior.
 */
export function resolveSource(product, specs, sourceKey) {
  if (!sourceKey) return undefined;
  const rd = product.raw_data && typeof product.raw_data === 'object' ? product.raw_data : {};
  let v;
  if (sourceKey === 'title') v = product.title;
  else if (sourceKey === 'description') v = product.description;
  else if (sourceKey === 'price') v = product.price;
  else if (sourceKey.startsWith('spec:')) v = specs ? specs[sourceKey.slice(5)] : undefined;
  else if (sourceKey.startsWith('raw:')) v = rd[sourceKey.slice(4)];
  else v = rd[sourceKey]; // bare standard key: category/subcategory/quantity/condition
  return v == null || v === '' ? undefined : v;
}

/**
 * Resolve a category for a product: an explicit override id wins; otherwise
 * best-effort auto-match against the marketplace tree using title + description.
 */
export function resolveCategory({
  marketplace,
  categoryId,
  categoryName,
  scrapedCategory,
  scrapedSubcategory,
  categoryMappings = {},
  product,
  overrides = {},
}) {
  const flat = flattenCategories(marketplace);
  // 0) Explicit admin override always wins.
  if (categoryId) {
    const found = flat.find((c) => String(c.term_id) === String(categoryId));
    if (found) return { category: { ...found, name: categoryName || found.name }, autoMatched: false };
    // Selected from the live API (not in the bundled config) — trust the choice.
    return { category: { term_id: Number(categoryId), name: categoryName || '', isSub: false }, autoMatched: false };
  }
  // 1) Saved category mapping (deterministic) — keyed by scraped category(+sub).
  const key = `${scrapedCategory || ''}||${scrapedSubcategory || ''}`;
  const mm = categoryMappings[key];
  if (mm && mm.term_id) {
    return {
      category: { term_id: Number(mm.term_id), name: mm.name || '', isSub: false },
      autoMatched: true,
      fromMapping: true,
    };
  }
  // 2) Best-effort fuzzy fallback on scraped category + title.
  const text = [scrapedSubcategory, scrapedCategory, overrides.product_title || product.title, product.description]
    .filter(Boolean)
    .join(' ');
  const m = matchCategory(marketplace, text);
  return { category: m, autoMatched: !!m };
}

/**
 * @param {object} args
 * @param {object} args.product   - scraped product row (title, description, price, images_remote_urls, …)
 * @param {string} args.marketplaceKey - marketplace name or site_type value
 * @param {object} args.seller    - { id, displayName }
 * @param {string} args.country
 * @param {string} [args.defaultCurrency] - the product's profile priceCurrency (pre-selects price_currency)
 * @param {object} [args.overrides] - per-product admin edits (incl. categoryId)
 * @param {Object<string,string>} [args.fieldMappings] - saved target_field → source_field routes.
 * @returns {{ productId:number, mainProductId:number|null, mapped:object, images:string[], category:object|null, categoryMatched:boolean, autoMatched:boolean, missing:string[], syncable:boolean }}
 */
export function mapProduct({
  product,
  marketplaceKey,
  seller,
  country,
  defaultCurrency,
  categoryMappings = {},
  overrides = {},
  fieldMappings = {},
}) {
  const marketplace = getMarketplace(marketplaceKey);
  const site_type = siteTypeFor(marketplace ? marketplace.name : marketplaceKey);
  const rd = product.raw_data && typeof product.raw_data === 'object' ? product.raw_data : {};
  const scrapedCategory = rd.category ? String(rd.category) : null;
  const scrapedSubcategory = rd.subcategory ? String(rd.subcategory) : null;

  // Scraped specs live under raw_data.specifications (a { label: value } object
  // built by a `table`-type field) with site-varying keys. Parse defensively.
  let specs = {};
  if (rd.specifications && typeof rd.specifications === 'object') specs = rd.specifications;
  else if (typeof rd.specifications === 'string') {
    try {
      specs = JSON.parse(rd.specifications) || {};
    } catch {
      specs = {};
    }
  }

  // A saved field mapping re-routes a target field to a chosen scraped SOURCE.
  // When set, its value takes precedence over the internal auto-detection but
  // still loses to a per-product admin override. Returns undefined when no
  // mapping is set or it resolves to nothing → fall back to default behavior.
  const routed = (targetKey) => resolveSource(product, specs, fieldMappings?.[targetKey]);

  // Intelligent fallbacks derived from scraped data — applied only when the
  // admin hasn't overridden the field (override > mapped source > scrape > default).
  const scrapedQuantity = simplifyQuantity(routed('quantity') ?? rd.quantity);
  const scrapedCondition = normalizeCondition(
    routed('item_condition') ?? findSpec(specs, [/item[\s_]*condition/i, /\bcondition\b/i]) ?? rd.condition,
  );
  const scrapedWeight = parseWeight(routed('weight_per_unit') ?? findSpec(specs, [/weight/i, /\bmass\b/i]));
  const scrapedDimensions = routed('dimensions') ?? findSpec(specs, [/dimension/i, /\bsize\b/i]);
  const scrapedBrand = routed('brand') ?? findSpec(specs, [/manufacturer/i, /\bbrand\b/i, /\bmake\b/i]);
  const scrapedModel = routed('model') ?? findSpec(specs, [/^model$/i, /\bmodel\b/i]);
  const scrapedSerial = routed('serial_number') ?? findSpec(specs, [/serial/i]);

  // Condition: admin override wins; else normalized scrape; else default Used.
  const overrideCondition = toArr(overrides.item_condition);
  const conditionArr = overrideCondition.length
    ? overrideCondition
    : [scrapedCondition || 'usedFunctional'];
  const { category, autoMatched, fromMapping } = resolveCategory({
    marketplace,
    categoryId: overrides.categoryId,
    categoryName: overrides.categoryName,
    scrapedCategory,
    scrapedSubcategory,
    categoryMappings,
    product,
    overrides,
  });

  const rawPrice =
    overrides.price_per_unit != null && overrides.price_per_unit !== ''
      ? overrides.price_per_unit
      : (routed('price_per_unit')
        ?? (product.price != null && product.price !== '' ? product.price : ''));

  const images = Array.isArray(overrides.images)
    ? overrides.images
    : Array.isArray(product.images_remote_urls)
      ? product.images_remote_urls
      : [];

  const mapped = {
    product_title: overrides.product_title ?? routed('product_title') ?? product.title ?? '',
    // Descriptions are sometimes HTML — send clean readable text to the main site.
    product_content: htmlToText(overrides.product_content ?? routed('product_content') ?? product.description ?? ''),
    product_type: overrides.product_type ?? routed('product_type') ?? SYNC_DEFAULTS.product_type,
    product_category_ids: category ? String(category.term_id) : '',
    category_name: category ? category.name : '',
    seller_name: seller?.displayName ?? '',
    post_author_id: seller ? String(seller.id) : '',
    steps: SYNC_DEFAULTS.steps,
    quantity: String(overrides.quantity ?? scrapedQuantity ?? SYNC_DEFAULTS.quantity),
    sellerVisible: SYNC_DEFAULTS.sellerVisible,
    replacement_cost_per_unit: overrides.replacement_cost_per_unit ?? routed('replacement_cost_per_unit') ?? '',
    weight_per_unit: overrides.weight_per_unit ?? (scrapedWeight ?? ''),
    country: routed('country') ?? country ?? '',
    item_grade: overrides.item_grade ?? routed('item_grade') ?? '',
    price_now_enabled: SYNC_DEFAULTS.price_now_enabled,
    price_format: overrides.price_format ?? routed('price_format') ?? SYNC_DEFAULTS.price_format,
    price_currency: overrides.price_currency ?? routed('price_currency') ?? defaultCurrency ?? SYNC_DEFAULTS.price_currency,
    price_per_unit: rawPrice === '' ? '' : String(rawPrice),
    item_condition: conditionArr,
    operation_status: overrides.operation_status
      ? toArr(overrides.operation_status)
      : routed('operation_status')
        ? toArr(routed('operation_status'))
        : SYNC_DEFAULTS.operation_status,
    location: toArr(overrides.location ?? routed('location') ?? (country ? [country] : [])),
    allowed_sites: [site_type],
  };

  // Optional equipment specs: admin override wins, else fall back to scraped
  // specs (only included when a value exists).
  if (overrides.brand) mapped.brand = String(overrides.brand).trim();
  else if (scrapedBrand) mapped.brand = scrapedBrand;
  if (overrides.model) mapped.model = String(overrides.model).trim();
  else if (scrapedModel) mapped.model = scrapedModel;
  if (overrides.serial_number) mapped.serial_number = String(overrides.serial_number).trim();
  else if (scrapedSerial) mapped.serial_number = scrapedSerial;
  if (overrides.dimensions) mapped.dimensions = String(overrides.dimensions).trim();
  else if (scrapedDimensions) mapped.dimensions = scrapedDimensions;
  const marketMetrics = overrides.market_metrics ?? routed('market_metrics');
  if (marketMetrics) {
    mapped.market_metrics =
      typeof marketMetrics === 'string' ? marketMetrics : JSON.stringify(marketMetrics);
  }

  // Mark the product as scraper-sourced on the main site.
  mapped.is_scraped = SYNC_DEFAULTS.is_scraped ? '1' : '';

  // Metadata bundle: every `meta:<label>` field mapping contributes one entry to
  // a single scrape_meta JSON object { label: scrapedValue }. Lets the admin
  // attach any number of scraped fields (incl. custom-labelled ones) to the
  // main-site product. Per-product `overrides.scrape_meta` (object) merges on top.
  const metaObj = {};
  for (const [k, sourceKey] of Object.entries(fieldMappings || {})) {
    if (!k.startsWith('meta:')) continue;
    const v = resolveSource(product, specs, sourceKey);
    if (v != null && v !== '') metaObj[k.slice(5)] = String(v);
  }
  if (overrides.scrape_meta && typeof overrides.scrape_meta === 'object') {
    Object.assign(metaObj, overrides.scrape_meta);
  }
  if (Object.keys(metaObj).length) mapped.scrape_meta = JSON.stringify(metaObj);

  // Required-field gating (see REQUIRED_FIELDS): category + price.
  const missing = [];
  if (!mapped.product_category_ids) missing.push('category');
  if (!mapped.price_per_unit) missing.push('price');

  return {
    productId: product.id,
    // Main-site id from a prior successful sync (null on first sync). When set,
    // the runner UPDATEs this product instead of creating a duplicate.
    mainProductId: product.main_product_id ?? null,
    mapped,
    images,
    category: category ? { ...category, autoMatched } : null,
    categoryMatched: !!category,
    autoMatched,
    fromMapping: !!fromMapping,
    scrapedCategory,
    scrapedSubcategory,
    missing,
    syncable: missing.length === 0,
  };
}

export default { mapProduct, resolveCategory, resolveSource };
