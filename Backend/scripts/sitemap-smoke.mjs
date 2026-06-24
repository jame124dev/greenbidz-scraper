/**
 * Network smoke test for the sitemap crawler.
 *
 * Two modes:
 *   1. Raw pattern:
 *        node scripts/sitemap-smoke.mjs <siteUrl> <productUrlPattern> [sitemapUrl]
 *   2. Profile dry-run (derives the pattern exactly as the crawl pipeline does,
 *      via productUrlPatternFromProfile — proves the wired decision logic):
 *        node scripts/sitemap-smoke.mjs <siteUrl> --profile <profile.json>
 *
 * Examples:
 *   node scripts/sitemap-smoke.mjs https://www.allbirds.com "/products/"
 *   node scripts/sitemap-smoke.mjs https://shop.example.com --profile ./my-profile.json
 *
 * Hits the live site read-only (sitemap + robots only) — safe to run. It does
 * NOT scrape product pages or write to the database.
 */
import fs from 'node:fs';
import { discoverProductUrls, productUrlPatternFromProfile } from '../scrapers/sitemap-crawler.js';

const [, , siteUrl, arg2, arg3] = process.argv;

let pattern = arg2;
let sitemapUrl = arg3;

if (siteUrl && arg2 === '--profile' && arg3) {
  const profile = JSON.parse(fs.readFileSync(arg3, 'utf8'));
  pattern = productUrlPatternFromProfile(profile);
  sitemapUrl = profile?.discovery?.sitemapUrl;
  console.log(`profile mode: derived pattern = ${pattern ?? '(none)'} (discovery.mode=${profile?.discovery?.mode ?? 'unset'})`);
}

if (!siteUrl || !pattern) {
  console.error('Usage: node scripts/sitemap-smoke.mjs <siteUrl> <productUrlPattern> [sitemapUrl]');
  console.error('   or: node scripts/sitemap-smoke.mjs <siteUrl> --profile <profile.json>');
  process.exit(1);
}

const start = Date.now();
const { products, sitemapsFetched, source } = await discoverProductUrls(
  { siteUrl, productUrlPattern: pattern, sitemapUrl },
  { maxUrls: 2000, maxSitemaps: 30 },
);
const secs = ((Date.now() - start) / 1000).toFixed(1);

console.log('\n──────── Sitemap smoke result ────────');
console.log(`site:            ${siteUrl}`);
console.log(`pattern:         ${pattern}`);
console.log(`sitemaps fetched:${sitemapsFetched}`);
console.log(`first urlset:    ${source ?? '(none)'}`);
console.log(`products matched:${products.length}`);
console.log(`time:            ${secs}s`);
console.log('\nsample (up to 10):');
for (const p of products.slice(0, 10)) {
  console.log(`  • ${p.productUrl}  [id=${p.externalId}${p.lastmod ? `, lastmod=${p.lastmod}` : ''}]`);
}
console.log('──────────────────────────────────────\n');

if (!products.length) {
  console.error('⚠️  No product URLs matched. Try a different pattern or pass an explicit sitemapUrl.');
  process.exit(2);
}
