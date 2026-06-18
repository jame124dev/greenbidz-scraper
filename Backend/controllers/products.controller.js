/**
 * @file controllers/products.controller.js — /api/products
 */
import { listRecentProducts, countProducts, getProductById, deleteProducts } from '../database/queries.js';
import { readAllProfiles } from '../utils/file-manager.js';
import { logger } from '../utils/logger.js';

/** Map profile fileName → its configured price currency (default USD). */
async function profileCurrencyMap() {
  const map = {};
  try {
    for (const e of await readAllProfiles()) {
      map[e.fileName] = e.profile?.priceCurrency || 'USD';
    }
  } catch {
    /* profiles unavailable — default applied below */
  }
  return map;
}

/** GET /api/products?limit=&offset=&status=&profile=&search= (paginated) */
export async function listProducts(req, res) {
  const limit = Number.parseInt(req.query.limit, 10) || 50;
  const offset = Number.parseInt(req.query.offset, 10) || 0;
  const status = ['scraped', 'unscraped', 'incomplete', 'synced'].includes(req.query.status) ? req.query.status : 'all';
  const scrapedOnly = req.query.scrapedOnly === 'true';
  const profile = req.query.profile || undefined;
  const search = req.query.search || undefined;

  const { products, total } = await listRecentProducts({
    limit,
    offset,
    status,
    scrapedOnly,
    profile,
    search,
  });
  const counts = await countProducts();
  const cur = await profileCurrencyMap();
  const withCurrency = products.map((p) => ({ ...p, price_currency: cur[p.profile_file_name] || 'USD' }));
  res.json({ counts, total, products: withCurrency });
}

/** GET /api/products/:id */
export async function getProduct(req, res) {
  const numId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(numId)) {
    return res.status(400).json({ error: 'Invalid product id.' });
  }
  const product = await getProductById(numId);
  if (!product) {
    return res.status(404).json({ error: 'Product not found.' });
  }
  const cur = await profileCurrencyMap();
  product.price_currency = cur[product.profile_file_name] || 'USD';
  res.json({ product });
}

/** POST /api/products/delete { ids } — remove product listings from the DB. */
export async function removeProducts(req, res) {
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || !ids.length) {
    return res.status(400).json({ error: 'ids (non-empty array) required.' });
  }
  const deleted = await deleteProducts(ids);
  logger.info(`🗑️  Deleted ${deleted} product(s) via UI.`);
  res.json({ ok: true, deleted });
}
