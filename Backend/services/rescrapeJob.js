/**
 * @file services/rescrapeJob.js
 * @description Re-fetch + re-extract specific products (e.g. ones missing
 * fields) as a tracked background job. Mirrors services/crawlJob.js. Each
 * product is re-scraped with its owning profile and OVERWRITTEN via the normal
 * persist path (upsertProduct), so stale/partial rows get refreshed.
 */
import { createJob, isCancelled, finishJob, failJob, updateJob } from '../web/jobs.js';
import { processProductUrl } from '../scheduler/job-runner.js';
import { getProductById } from '../database/queries.js';
import { readProfile, profileExists } from '../utils/file-manager.js';
import { launchBrowser, closeBrowser } from '../config/puppeteer.js';
import { logger } from '../utils/logger.js';

/**
 * Start a background rescrape over the given product ids.
 * @param {number[]} productIds
 * @returns {string} jobId
 */
export function startRescrapeJob(productIds) {
  const ids = (Array.isArray(productIds) ? productIds : []).map(Number).filter((n) => Number.isInteger(n));
  const jobId = createJob({
    kind: 'rescrape',
    label: `Rescrape ${ids.length} product(s)`,
    total: ids.length,
    phase: 'scraping',
  });

  (async () => {
    const browser = await launchBrowser();
    let scraped = 0;
    let failed = 0;
    try {
      for (const id of ids) {
        if (isCancelled(jobId)) break;
        // eslint-disable-next-line no-await-in-loop
        const product = await getProductById(id).catch(() => null);
        if (!product || !product.product_url) {
          failed += 1;
          updateJob(jobId, { failed });
          continue;
        }

        // Re-scrape with the product's own profile when known, else let
        // processProductUrl resolve a matching profile from the URL.
        let forced = null;
        const fn = product.profile_file_name;
        if (fn) {
          try {
            // eslint-disable-next-line no-await-in-loop
            if (await profileExists(fn)) forced = { fileName: fn, profile: await readProfile(fn) };
          } catch {
            /* fall back to auto-resolve */
          }
        }

        updateJob(jobId, { current: product.product_url });
        try {
          // eslint-disable-next-line no-await-in-loop
          const r = await processProductUrl(product.product_url, browser, forced ? { forcedProfile: forced } : {});
          if (r.status === 'saved') scraped += 1;
          else failed += 1;
        } catch (err) {
          failed += 1;
          logger.warn(`Rescrape failed for ${product.product_url}: ${err.message}`);
        }
        updateJob(jobId, { scraped, failed });
      }
      finishJob(jobId, { status: isCancelled(jobId) ? 'cancelled' : 'done' });
      logger.info(`🔁 Rescrape done — ${scraped} ok, ${failed} failed of ${ids.length}.`);
    } catch (err) {
      failJob(jobId, err.message);
    } finally {
      await closeBrowser(browser);
    }
  })();

  return jobId;
}

export default { startRescrapeJob };
