/**
 * @file services/syncJob.js
 * @description Background runner for a sync run. Mirrors services/crawlJob.js:
 * fire-and-forget, tracked via the in-memory web/jobs.js registry for live
 * progress, and persisted to sync_runs / sync_items for durable history.
 *
 * Per chunk: map products (reusing buildBatch), record blocked products as
 * `skipped`, then dispatch the syncable ones via sendSyncableBatch — products
 * with a stored main_product_id are UPDATED in place (resync), the rest are
 * CREATED — and record each as `success` (got a main id) or `failed`. Successful
 * products flow through the existing markProductsSynced so products.synced_at
 * stays authoritative.
 */
import { createJob, isCancelled, finishJob, failJob, updateJob } from '../web/jobs.js';
import { buildBatch } from '../controllers/sync.controller.js';
import { sendSyncableBatch } from './syncDispatch.js';
import { siteTypeFor, getMarketplace } from '../config/sync-config.js';
import { addSyncItems, updateSyncRun, markProductsSynced } from '../database/queries.js';
import { logger } from '../utils/logger.js';

const CHUNK_SIZE = 25;

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/**
 * Start a background sync job for an already-created sync_run.
 *
 * @param {object} args
 * @param {number} args.runId
 * @param {number[]} args.productIds
 * @param {string} args.marketplace
 * @param {number} args.sellerId
 * @param {string} [args.sellerName]
 * @param {string} [args.country]
 * @param {object} [args.overrides] - per-product overrides keyed by productId.
 * @returns {string} jobId
 */
export function startSyncJob({ runId, productIds, marketplace, sellerId, sellerName, country, overrides = {} }) {
  const total = productIds.length;
  const jobId = createJob({ kind: 'sync', runId, total });
  const start = Date.now();
  const siteType = getMarketplace(marketplace) ? siteTypeFor(getMarketplace(marketplace).name) : marketplace;

  // Link the in-memory job to the durable run for live polling.
  updateSyncRun(runId, { job_id: jobId }).catch(() => {});

  (async () => {
    let success = 0;
    let failed = 0;
    let fatal = null;

    try {
      for (const ids of chunk(productIds, CHUNK_SIZE)) {
        if (isCancelled(jobId)) break;

        // Map this chunk (reuses the exact same logic as the synchronous flow).
        const batch = await buildBatch({ productIds: ids, marketplace, sellerId, sellerName, country, overrides });
        if (batch.error) {
          // Whole chunk unmappable (bad marketplace/seller) — record as failed.
          await addSyncItems(ids.map((id) => ({ sync_run_id: runId, product_id: Number(id), status: 'failed', error: batch.error })));
          failed += ids.length;
          updateJob(jobId, { failed });
          continue;
        }

        const items = [];
        const syncable = [];
        for (const r of batch.results) {
          if (r.error) {
            items.push({ sync_run_id: runId, product_id: r.productId, status: 'failed', error: r.error });
          } else if (!r.syncable) {
            items.push({ sync_run_id: runId, product_id: r.productId, status: 'skipped', error: `missing: ${(r.missing || []).join(', ')}` });
          } else {
            syncable.push(r);
          }
        }
        // Blocked/skipped + not-found count as failed for the run summary.
        failed += items.length;

        if (syncable.length) {
          // Products with a stored main id are UPDATED in place; the rest are
          // CREATED. Outcomes are per-product regardless of which path ran.
          const { outcomes, mainIdByProductId, batchByProductId } = await sendSyncableBatch({
            siteType,
            syncable,
            country: country || '',
            seller: batch.seller,
          });

          const successIds = [];
          for (const o of outcomes) {
            if (o.ok) {
              items.push({ sync_run_id: runId, product_id: o.productId, status: 'success', main_product_id: o.mainId });
              successIds.push(o.productId);
              success += 1;
            } else {
              items.push({ sync_run_id: runId, product_id: o.productId, status: 'failed', error: o.error });
              failed += 1;
            }
          }
          if (successIds.length) {
            // Refreshes synced_at; persists main id/batch/site_type for created ones.
            await markProductsSynced(successIds, {
              mainIdByProductId,
              batchByProductId,
              siteType,
              seller: { id: sellerId, name: sellerName },
            }).catch((e) => logger.warn(`syncJob: markProductsSynced failed: ${e.message}`));
          }
        }

        await addSyncItems(items);
        updateJob(jobId, { scraped: success, failed });
      }
    } catch (err) {
      fatal = err.message;
      logger.error(`Sync job ${jobId} crashed: ${err.message}`, { stack: err.stack });
    }

    // Finalize the durable run.
    const cancelled = isCancelled(jobId);
    let status;
    if (fatal) status = 'failed';
    else if (cancelled) status = 'cancelled';
    else if (failed === 0 && success > 0) status = 'completed';
    else if (success === 0) status = 'failed';
    else status = 'partial';

    await updateSyncRun(runId, {
      status,
      success_count: success,
      failed_count: failed,
      error_message: fatal,
      finished_at: new Date(),
      duration_seconds: Math.round((Date.now() - start) / 1000),
    }).catch((e) => logger.warn(`syncJob: finalize failed: ${e.message}`));

    if (fatal) failJob(jobId, fatal);
    else finishJob(jobId, { status: cancelled ? 'cancelled' : 'done' });
    logger.info(`⏫ Sync run ${runId} ${status} — ${success} ok, ${failed} failed.`);
  })();

  return jobId;
}

export default { startSyncJob };
