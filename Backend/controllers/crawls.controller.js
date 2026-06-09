/**
 * @file controllers/crawls.controller.js — GET /api/crawl-history, /api/active-crawls
 */
import { listCrawlHistory } from '../database/queries.js';
import { listJobs } from '../web/jobs.js';

export async function getCrawlHistory(req, res) {
  const limit = Number.parseInt(req.query.limit, 10) || 100;
  const history = await listCrawlHistory({ limit });
  res.json({ history });
}

/** GET /api/active-crawls — crawl jobs currently running (live, in-memory). */
export async function getActiveCrawls(req, res) {
  const active = listJobs('running').map((j) => ({
    id: j.id,
    kind: j.kind || 'crawl', // crawl | rescrape
    label: j.label || null, // friendly label (e.g. "Rescrape 3 product(s)")
    listingUrls: Array.isArray(j.listingUrls) ? j.listingUrls : [],
    phase: j.phase, // starting | discovering | scraping
    found: j.found || 0,
    total: j.total || 0, // selected to scrape this run
    scraped: j.scraped || 0,
    failed: j.failed || 0,
    current: j.current || null, // url being scraped now
    startedAt: j.startedAt || null,
  }));
  res.json({ active });
}
