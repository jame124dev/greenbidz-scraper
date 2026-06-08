/**
 * @file scripts/ensure-chrome.mjs
 * @description Runs as `postinstall`. Ensures Puppeteer's Chrome is installed
 * into the project-relative cache (see ../.puppeteerrc.cjs) on every `npm
 * install`. This matters on hosts like Render that reuse the node_modules build
 * cache — there, Puppeteer's own bundled download step is skipped, so Chrome
 * never lands at runtime ("Could not find Chrome ..."). Invoking the Puppeteer
 * CLI here forces the download (it's a fast no-op when Chrome is already present).
 */
import { execSync } from 'node:child_process';

try {
  console.log('[ensure-chrome] Ensuring Puppeteer Chrome is installed…');
  // Honors .puppeteerrc.cjs (cacheDirectory) since cwd is the package root.
  execSync('npx --no-install puppeteer browsers install chrome', { stdio: 'inherit' });
  console.log('[ensure-chrome] Chrome is ready.');
} catch (err) {
  // Don't hard-fail the install: the server still boots (API works); crawls log
  // a clear "Could not find Chrome" error if this didn't succeed.
  console.warn(`[ensure-chrome] Skipped/failed: ${err.message}`);
}
