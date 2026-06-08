/**
 * @file web/jobs.js
 * @description Tiny in-memory registry of running scrape jobs so the UI can poll
 *              live progress (discovered / scraping / scraped) and show an
 *              animated progress screen. Jobs are ephemeral (lost on restart).
 */

/** @type {Map<string, object>} */
const jobs = new Map();
let seq = 0;

/** Create a job and return its id. */
export function createJob(meta = {}) {
  seq += 1;
  const id = `job_${seq}_${Date.now().toString(36)}`;
  jobs.set(id, {
    id,
    status: 'running', // running | done | error
    phase: 'starting', // starting | discovering | scraping | done | error
    found: 0, // products discovered
    total: 0, // products selected to scrape this run
    scraped: 0,
    failed: 0,
    current: null, // url currently being scraped
    error: null,
    startedAt: Date.now(),
    finishedAt: null,
    ...meta,
  });
  // Cap registry size: drop oldest finished jobs beyond 50.
  if (jobs.size > 50) {
    const oldest = [...jobs.values()]
      .filter((j) => j.status !== 'running')
      .sort((a, b) => (a.finishedAt || 0) - (b.finishedAt || 0))[0];
    if (oldest) jobs.delete(oldest.id);
  }
  return id;
}

export function getJob(id) {
  return jobs.get(id) || null;
}

/** All tracked jobs, newest first. Optionally filter to a status. */
export function listJobs(status = null) {
  const all = [...jobs.values()].sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  return status ? all.filter((j) => j.status === status) : all;
}

export function updateJob(id, patch) {
  const j = jobs.get(id);
  if (j) Object.assign(j, patch);
}

/**
 * Build an onProgress(evt) handler that folds crawl events into a job. Events:
 *   { phase:'discovered', found, total }
 *   { phase:'scraping', current }
 *   { phase:'item-done', ok }
 */
export function jobProgress(id) {
  return (evt) => {
    const j = jobs.get(id);
    if (!j || !evt) return;
    if (evt.phase === 'discovered') {
      j.found += evt.found || 0;
      j.total += evt.total || 0;
      j.phase = 'scraping';
    } else if (evt.phase === 'scraping') {
      j.current = evt.current || null;
      j.phase = 'scraping';
    } else if (evt.phase === 'item-done') {
      if (evt.ok) j.scraped += 1;
      else j.failed += 1;
    }
  };
}

/** Request cancellation of a running job (the crawl loop polls isCancelled). */
export function cancelJob(id) {
  const j = jobs.get(id);
  if (j && j.status === 'running') {
    j.cancelRequested = true;
    return true;
  }
  return false;
}

export function isCancelled(id) {
  const j = jobs.get(id);
  return !!(j && j.cancelRequested);
}

export function finishJob(id, patch = {}) {
  const j = jobs.get(id);
  if (!j) return;
  Object.assign(j, { status: 'done', phase: 'done', current: null, finishedAt: Date.now() }, patch);
}

export function failJob(id, message) {
  const j = jobs.get(id);
  if (!j) return;
  Object.assign(j, { status: 'error', phase: 'error', error: message, finishedAt: Date.now() });
}

export default {
  createJob,
  getJob,
  listJobs,
  updateJob,
  jobProgress,
  cancelJob,
  isCancelled,
  finishJob,
  failJob,
};
