/**
 * @file utils/contentHash.js
 * @description Content fingerprint for change detection. A short, stable hash of
 *   the product fields we care about (title, price, description). Re-scraping a
 *   product and comparing the new fingerprint to the one stored at last sync
 *   tells us whether the SOURCE changed and the main site needs updating.
 *
 *   Images are intentionally excluded — they aren't synced on update yet, so a
 *   changed image should not flag a product as needing re-sync.
 */
import crypto from 'node:crypto';

/** Collapse whitespace, trim, lowercase — so cosmetic noise isn't a "change". */
function normText(v) {
  return String(v ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Normalize a price to a stable string: numeric → 2dp; otherwise trimmed text. */
function normPrice(v) {
  if (v == null || v === '') return '';
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n.toFixed(2) : String(v).trim();
}

/**
 * Compute the content fingerprint for a product.
 * @param {{ title?: any, price?: any, description?: any }} fields
 * @returns {string} 64-char sha256 hex digest.
 */
export function fingerprint(fields = {}) {
  const canonical = [
    normText(fields.title),
    normPrice(fields.price),
    normText(fields.description),
  ].join('||');
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

export default { fingerprint };
