/**
 * @file config/constants.js
 * @description Central configuration constants derived from environment variables.
 *              All tunable values (crawl interval, retry limits, paths, timeouts)
 *              live here so the rest of the codebase never reads `process.env` directly.
 */

import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Absolute path to the project root (one level up from /config). */
export const ROOT_DIR = path.resolve(__dirname, '..');

/**
 * Resolve a path that is configured relative to the project root.
 * @param {string} relative - Relative path from env (e.g. "downloads").
 * @param {string} fallback - Default folder name if env value is missing.
 * @returns {string} Absolute path.
 */
const resolveFromRoot = (relative, fallback) =>
  path.resolve(ROOT_DIR, relative || fallback);

/** Parse an integer env var with a fallback. */
const intEnv = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

/** Parse a boolean-ish env var ("true"/"1"/"yes"). */
const boolEnv = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  return /^(true|1|yes)$/i.test(String(value).trim());
};

export const CONSTANTS = {
  // ── Crawl scheduling ──────────────────────────────────────────
  CRAWL_INTERVAL_HOURS: intEnv(process.env.CRAWL_INTERVAL_HOURS, 2),

  // ── Retry policy ──────────────────────────────────────────────
  MAX_RETRIES: intEnv(process.env.MAX_RETRIES, 3),
  RETRY_DELAY_MS: intEnv(process.env.RETRY_DELAY_MS, 2000),

  // ── Image downloading ─────────────────────────────────────────
  DOWNLOAD_IMAGES: boolEnv(process.env.DOWNLOAD_IMAGES, true),

  // ── Scrape scope ──────────────────────────────────────────────
  // true  → each crawl scrapes ONLY products not yet scraped
  //         (products.scraped = FALSE). New products are discovered,
  //         recorded as scraped = FALSE, then scraped and flipped to TRUE.
  // false → re-scrape every discovered product on every cycle (refresh
  //         existing products too).
  ONLY_NEW_PRODUCTS: boolEnv(process.env.ONLY_NEW_PRODUCTS, true),

  // ── Puppeteer ─────────────────────────────────────────────────
  HEADLESS: boolEnv(process.env.HEADLESS, true),
  PAGE_TIMEOUT_MS: intEnv(process.env.PAGE_TIMEOUT_MS, 30000),
  NAV_WAIT_UNTIL: process.env.NAV_WAIT_UNTIL || 'networkidle2',
  VIEWPORT: { width: 1920, height: 1080 },

  // ── Mapping Studio proxy renderer (web/proxy/page-proxy.js) ───
  // These ONLY affect the interactive proxy renderer, not the scrapers.
  // Overall wall-clock budget for one proxy render.
  PROXY_RENDER_TIMEOUT_MS: intEnv(process.env.PROXY_RENDER_TIMEOUT_MS, 60000),
  // How long to wait for meaningful content to appear after navigation.
  PROXY_CONTENT_WAIT_MS: intEnv(process.env.PROXY_CONTENT_WAIT_MS, 25000),
  // Quiet settle period after content appears (lets late cards/text paint).
  PROXY_SETTLE_MS: intEnv(process.env.PROXY_SETTLE_MS, 1500),
  // After settling, keep waiting (up to this long) until the DOM stops growing,
  // so JS-hydrated sections (e.g. a late "Specifications" block) make it into the
  // snapshot. Resolves early once the DOM is stable, so fast pages aren't delayed.
  PROXY_STABILIZE_MS: intEnv(process.env.PROXY_STABILIZE_MS, 6000),
  // Block image/media downloads DURING the backend render (the <img src> tags
  // stay in the snapshot and load in the user's browser via <base href>, so the
  // Studio still shows images — this just stops the backend waiting on them).
  PROXY_BLOCK_IMAGES: boolEnv(process.env.PROXY_BLOCK_IMAGES, true),
  // Persistent Chromium profile for the proxy browser so JS/CSS bundles are
  // cached across renders (2nd+ render of a domain is far faster).
  PROXY_CACHE_DIR: resolveFromRoot(process.env.PROXY_CACHE_DIR, '.proxy-cache'),

  // ── Pagination safety limits ──────────────────────────────────
  MAX_PAGES: intEnv(process.env.MAX_PAGES, 500),

  // ── Per-profile product cap ───────────────────────────────────
  // Max number of products (scraped + unscraped) recorded per site/profile.
  // Discovery stops creating NEW rows for a profile once it hits this; already
  // recorded products keep getting scraped.
  MAX_PRODUCTS_PER_PROFILE: intEnv(process.env.MAX_PRODUCTS_PER_PROFILE, 1000),

  // ── Filesystem paths ──────────────────────────────────────────
  DOWNLOADS_DIR: resolveFromRoot(process.env.DOWNLOADS_DIR, 'downloads'),
  LOGS_DIR: resolveFromRoot(process.env.LOGS_DIR, 'logs'),
  PROFILES_DIR: resolveFromRoot(process.env.PROFILES_DIR, 'profiles'),

  // ── Listing pages ─────────────────────────────────────────────
  LISTING_URLS: (process.env.LISTING_URLS || '')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean),
};

/**
 * A rotating pool of realistic desktop user-agents.
 * @type {string[]}
 */
export const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
];

export default CONSTANTS;
