/**
 * @file services/syncDispatch.js
 * @description Shared create-or-update dispatch for a set of already-mapped,
 * syncable products. Products that carry a `mainProductId` (synced before) are
 * UPDATED in place on the main site via patchMainProduct so a resync edits the
 * existing listing instead of creating a duplicate; the rest are CREATED via the
 * batched postGroupedListings call. Used by both the background sync-job runner
 * and the synchronous /api/sync/submit endpoint so their behavior stays identical.
 */
import { postGroupedListings, patchMainProduct } from './syncSender.js';

/**
 * @param {object} args
 * @param {string} args.siteType - x-platform value.
 * @param {object[]} args.syncable - mapProduct() results that passed required-field gating.
 * @param {string} args.country
 * @param {{ id: number }} args.seller
 * @returns {Promise<{
 *   outcomes: Array<{ productId:number, ok:boolean, mainId?:number, batchId?:number, mode:'create'|'update', error?:string }>,
 *   mainIdByProductId: Record<number, number>,
 *   batchByProductId: Record<number, number>,
 * }>}
 */
export async function sendSyncableBatch({ siteType, syncable, country, seller }) {
  const toUpdate = syncable.filter((r) => r.mainProductId != null);
  const toCreate = syncable.filter((r) => r.mainProductId == null);

  const outcomes = [];
  const mainIdByProductId = {};
  const batchByProductId = {};

  // Updates — one PATCH per product (the admin editor is single-product). The
  // batch id was captured on the original create, so it isn't changed here.
  for (const r of toUpdate) {
    // eslint-disable-next-line no-await-in-loop
    const res = await patchMainProduct({ mainProductId: r.mainProductId, mapped: r.mapped, siteType });
    if (res.ok) {
      outcomes.push({ productId: r.productId, ok: true, mainId: r.mainProductId, mode: 'update' });
      mainIdByProductId[r.productId] = r.mainProductId;
    } else {
      outcomes.push({ productId: r.productId, ok: false, mode: 'update', error: res.error });
    }
  }

  // Creates — one batched POST for the whole group.
  if (toCreate.length) {
    const sent = await postGroupedListings({ siteType, results: toCreate, country: country || '', seller });
    if (!sent.ok) {
      for (const r of toCreate) {
        outcomes.push({ productId: r.productId, ok: false, mode: 'create', error: sent.error || `HTTP ${sent.status}` });
      }
    } else {
      for (const r of toCreate) {
        const mid = sent.mainIdByProductId[r.productId];
        const bid = sent.mainBatchByProductId[r.productId];
        if (mid != null) {
          outcomes.push({ productId: r.productId, ok: true, mainId: mid, batchId: bid, mode: 'create' });
          mainIdByProductId[r.productId] = mid;
          if (bid != null) batchByProductId[r.productId] = bid;
        } else {
          outcomes.push({ productId: r.productId, ok: false, mode: 'create', error: 'No main product id returned.' });
        }
      }
    }
  }

  return { outcomes, mainIdByProductId, batchByProductId };
}

export default { sendSyncableBatch };
