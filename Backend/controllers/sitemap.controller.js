/**
 * @file controllers/sitemap.controller.js
 * @description Endpoints for the Mapping Studio "Sitemap" step: summarize a
 * site's sitemap into sections, and count how many URLs a pattern matches.
 */
import { isValidUrl } from '../utils/validators.js';
import { summarizeSitemap, matchSitemap } from '../services/sitemapExplorer.js';

/** GET /api/sitemap/summary?siteUrl=&sitemapUrl= */
export async function sitemapSummary(req, res) {
  const { siteUrl, sitemapUrl } = req.query || {};
  if (!isValidUrl(siteUrl)) {
    return res.status(400).json({ error: 'Please provide a valid siteUrl (http/https).' });
  }
  const summary = await summarizeSitemap({ siteUrl, sitemapUrl: sitemapUrl || undefined });
  if (!summary.sections.length) {
    return res.status(404).json({
      error: 'No sitemap found for this site (robots.txt + common paths returned nothing).',
      ...summary,
    });
  }
  return res.json(summary);
}

/** GET /api/sitemap/match?siteUrl=&sitemapUrl=&pattern= */
export async function sitemapMatch(req, res) {
  const { siteUrl, sitemapUrl, pattern } = req.query || {};
  if (!isValidUrl(siteUrl)) {
    return res.status(400).json({ error: 'Please provide a valid siteUrl (http/https).' });
  }
  if (!pattern || !String(pattern).trim()) {
    return res.status(400).json({ error: 'A pattern is required.' });
  }
  try {
    const result = await matchSitemap({ siteUrl, sitemapUrl: sitemapUrl || undefined, pattern });
    return res.json(result);
  } catch (err) {
    return res.status(err.statusCode || 500).json({ error: err.message });
  }
}

export default { sitemapSummary, sitemapMatch };
