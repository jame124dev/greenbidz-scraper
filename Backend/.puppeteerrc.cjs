/**
 * @file .puppeteerrc.cjs — Puppeteer configuration.
 *
 * Pin the browser download cache to a project-relative directory instead of the
 * default ~/.cache/puppeteer. On hosts like Render the home cache is NOT
 * preserved between build and runtime, so Chrome "disappears" at launch time
 * ("Could not find Chrome ..."). Keeping it inside the project tree (which IS
 * persisted) makes the build-installed Chrome available at runtime.
 *
 * Both `npm install` (postinstall download) and `npx puppeteer browsers install
 * chrome` honour this path, as does puppeteer.launch() at runtime.
 */
const { join } = require('node:path');

module.exports = {
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};
