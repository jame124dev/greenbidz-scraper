/**
 * @file web/proxy/page-proxy.js
 * @description Render an arbitrary external page with Puppeteer and return a
 *              SANITISED, same-origin HTML snapshot the Mapping Studio can load
 *              into an iframe and make interactive.
 *
 *              Why: browsers block framing arbitrary sites (X-Frame-Options /
 *              CSP) and same-origin policy stops us reading their DOM. By
 *              rendering server-side and serving the HTML from OUR origin, the
 *              injected selector script can run inside the iframe.
 *
 *              Sanitisation:
 *                - strip <script> (page must not navigate / re-render away),
 *                - strip CSP <meta> (would block our inline script),
 *                - inject <base href> so the site's own relative CSS/img/links
 *                  still resolve against the real origin,
 *                - inject our selector style + script.
 */

import { launchBrowser, newPage, closeBrowser } from '../../config/puppeteer.js';
import { CONSTANTS } from '../../config/constants.js';
import { logger } from '../../utils/logger.js';
import { SELECTOR_SCRIPT, SELECTOR_STYLE } from './selector-inject.js';

// A single shared browser for the interactive builder (cheaper than launching
// one per request). Recreated lazily if it dies.
let sharedBrowser = null;

// In-memory snapshot cache so back/forward (or revisiting a URL) is instant and
// doesn't re-scrape. Keyed by the page URL; small TTL + LRU cap. Explicit Reload
// bypasses it (force) and refreshes the entry.
const RENDER_CACHE = new Map(); // url -> { html, finalUrl, title, ts }
const RENDER_CACHE_TTL_MS = 10 * 60 * 1000; // 10 min
const RENDER_CACHE_MAX = 40;

function getCachedRender(url) {
  const e = RENDER_CACHE.get(url);
  if (!e) return null;
  if (Date.now() - e.ts > RENDER_CACHE_TTL_MS) {
    RENDER_CACHE.delete(url);
    return null;
  }
  // Touch for LRU ordering.
  RENDER_CACHE.delete(url);
  RENDER_CACHE.set(url, e);
  return e;
}

function setCachedRender(url, val) {
  RENDER_CACHE.set(url, { ...val, ts: Date.now() });
  while (RENDER_CACHE.size > RENDER_CACHE_MAX) {
    const oldest = RENDER_CACHE.keys().next().value;
    RENDER_CACHE.delete(oldest);
  }
}

// (B) Third-party hosts that hang or stall headless renders and add nothing to
// the snapshot — analytics, ads, tag managers, chat widgets. Matched as substrings.
const BLOCK_HOSTS = [
  'google-analytics.com', 'googletagmanager.com', 'doubleclick.net',
  'googleadservices.com', 'googlesyndication.com', 'google.com/ccm',
  'google.com/rmkt', 'google.com/pagead', 'facebook.net', 'connect.facebook',
  'hotjar.com', 'clarity.ms', 'tawk.to', 'intercom.io', 'segment.io',
  'fullstory.com', 'mixpanel.com', 'sentry.io',
];

// (B) Resource types that are pure weight for DOM mapping. Images/media are
// re-fetched in the user's browser via <base href>, so the snapshot still shows
// them; stylesheets/scripts/xhr are kept (the SPA needs them to render).
const ALWAYS_BLOCK_TYPES = new Set(['media', 'font']);

async function getBrowser() {
  const alive =
    sharedBrowser &&
    (typeof sharedBrowser.connected === 'boolean'
      ? sharedBrowser.connected
      : sharedBrowser.isConnected?.());
  if (!alive) {
    // Dedicated persistent profile for the proxy (C): caches JS/CSS bundles so
    // repeat renders of the same domain are far faster. Kept separate from the
    // scrapers' default (fresh) profile so the two never share a profile lock.
    sharedBrowser = await launchBrowser({ userDataDir: CONSTANTS.PROXY_CACHE_DIR });
  }
  return sharedBrowser;
}

/**
 * Dismiss cookie/consent banners and blocking modal overlays, and unlock page
 * scroll, so the snapshot shows the actual content instead of a popup. Runs in
 * the live page before we capture HTML (scripts are stripped afterwards, so the
 * banner can't re-inject into the static snapshot). Best-effort and defensive.
 * @param {import('puppeteer').Page} page
 */
async function dismissOverlays(page) {
  await page
    .evaluate(() => {
      const clickAll = (sel) => {
        document.querySelectorAll(sel).forEach((el) => {
          try {
            el.click();
          } catch {
            /* ignore */
          }
        });
      };

      // 1) Known consent/cookie "accept" buttons across common CMPs.
      [
        '#onetrust-accept-btn-handler',
        '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
        '#CybotCookiebotDialogBodyButtonAccept',
        '#CybotCookiebotDialogBodyButtonAcceptAll',
        '[data-testid="uc-accept-all-button"]',
        '[data-testid="cookie-accept"]',
        '.cc-allow',
        '.cookie-accept',
        'button[aria-label*="accept" i]',
        'button[title*="accept" i]',
      ].forEach(clickAll);

      // 2) Text-matched accept/close buttons (EN + DE — surplex is German).
      const wantText =
        /^(accept all|accept|agree|i agree|allow all|allow|got it|ok|okay|continue|alle akzeptieren|akzeptieren|zustimmen|verstanden|einverstanden)$/i;
      document.querySelectorAll('button, a[role="button"], [role="button"], input[type="button"], input[type="submit"]').forEach((el) => {
        const t = (el.textContent || el.value || '').trim();
        if (t && t.length < 32 && wantText.test(t)) {
          try {
            el.click();
          } catch {
            /* ignore */
          }
        }
      });

      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const isOverlay = (el) => {
        const cs = getComputedStyle(el);
        if (cs.position !== 'fixed' && cs.position !== 'sticky') return false;
        const r = el.getBoundingClientRect();
        const z = parseInt(cs.zIndex, 10) || 0;
        const coversMost = r.width >= vw * 0.6 && r.height >= vh * 0.4;
        const hasBackdrop = cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent';
        return (coversMost && (z >= 100 || hasBackdrop)) || (z >= 1000 && hasBackdrop);
      };

      // 3) Remove cookie/consent/gdpr/cmp containers (only if they look like overlays).
      const named = '[id*="cookie" i],[class*="cookie" i],[id*="consent" i],[class*="consent" i],[id*="gdpr" i],[class*="gdpr" i],[id*="cmp" i],[class*="cmp-" i],[aria-modal="true"],[role="dialog"]';
      document.querySelectorAll(named).forEach((el) => {
        try {
          if (isOverlay(el) || /cookie|consent|gdpr/i.test(el.id + ' ' + el.className)) el.remove();
        } catch {
          /* ignore */
        }
      });

      // 4) Remove any remaining full-screen fixed backdrop/overlay near the body root.
      document.querySelectorAll('body > *, body > * > *').forEach((el) => {
        try {
          if (isOverlay(el)) el.remove();
        } catch {
          /* ignore */
        }
      });

      // 5) Undo scroll locks the banner may have set on <html>/<body>.
      for (const node of [document.documentElement, document.body]) {
        if (!node) continue;
        node.style.overflow = '';
        node.style.position = '';
        node.style.height = '';
        node.style.paddingRight = '';
      }
    })
    .catch(() => {});
}

/**
 * Wait until the DOM stops growing (or a budget elapses), so late JS-hydrated
 * sections — e.g. a "Specifications" block that mounts a beat after the main
 * content — are present before we snapshot and strip scripts. Resolves as soon
 * as the DOM is stable for a couple of polls, so fast pages aren't delayed.
 * Best-effort; never throws.
 * @param {import('puppeteer').Page} page
 * @param {object} [opts]
 * @param {number} [opts.maxMs] - Hard cap on how long to keep waiting.
 */
async function waitForDomStable(page, { maxMs = 6000, interval = 400, stableRounds = 2 } = {}) {
  await page
    .evaluate(
      async ({ maxMs, interval, stableRounds }) => {
        const measure = () =>
          document.body
            ? `${document.body.innerHTML.length}|${document.body.querySelectorAll('*').length}`
            : '';
        let last = measure();
        let stable = 0;
        const start = Date.now();
        while (Date.now() - start < maxMs) {
          await new Promise((r) => setTimeout(r, interval));
          const cur = measure();
          if (cur === last) {
            stable += 1;
            if (stable >= stableRounds) return;
          } else {
            stable = 0;
            last = cur;
          }
        }
      },
      { maxMs, interval, stableRounds },
    )
    .catch(() => {});
}

/** Best-effort close of the shared browser (e.g. on shutdown). */
export async function closeProxyBrowser() {
  if (sharedBrowser) {
    await closeBrowser(sharedBrowser);
    sharedBrowser = null;
  }
}

/**
 * Remove <script> tags, CSP meta tags, and existing <base> tags from raw HTML.
 * @param {string} html
 * @returns {string}
 */
function stripUnsafe(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<script\b[^>]*\/>/gi, '')
    .replace(/<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi, '')
    .replace(/<base\b[^>]*>/gi, '');
}

/**
 * Inject our <base href>, selector style, and selector script into the HTML.
 * @param {string} html
 * @param {string} pageUrl - The real page URL (for <base href>).
 * @returns {string}
 */
function injectStudio(html, pageUrl) {
  const baseTag = `<base href="${pageUrl.replace(/"/g, '&quot;')}">`;
  const styleTag = `<style id="__sx_style">${SELECTOR_STYLE}</style>`;
  const scriptTag = `<script id="__sx_script">${SELECTOR_SCRIPT}</script>`;

  let out = html;

  // <base> must come first inside <head> so relative URLs resolve correctly.
  if (/<head[^>]*>/i.test(out)) {
    out = out.replace(/<head[^>]*>/i, (m) => `${m}\n${baseTag}\n${styleTag}`);
  } else {
    out = `${baseTag}${styleTag}${out}`;
  }

  if (/<\/body>/i.test(out)) {
    out = out.replace(/<\/body>/i, `${scriptTag}\n</body>`);
  } else {
    out += scriptTag;
  }
  return out;
}

/**
 * Render + sanitise a page for the Mapping Studio iframe.
 *
 * @param {string} pageUrl
 * @param {object} [opts]
 * @param {boolean} [opts.force] - Bypass + refresh the snapshot cache (Reload).
 * @returns {Promise<{ html: string, finalUrl: string, title: string }>}
 */
export async function renderProxyPage(pageUrl, { force = false } = {}) {
  if (!force) {
    const cached = getCachedRender(pageUrl);
    if (cached) {
      logger.info(`🪞 Proxy cache hit ${pageUrl}`);
      return { html: cached.html, finalUrl: cached.finalUrl, title: cached.title };
    }
  }
  const browser = await getBrowser();
  const page = await newPage(browser);
  try {
    logger.info(`🪞 Proxy-rendering ${pageUrl}`);

    // (B) Drop tracker hosts + heavy resource types so the render isn't held
    // hostage by hanging third-party requests or thousands of product images.
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (typeof req.isInterceptResolutionHandled === 'function' && req.isInterceptResolutionHandled()) {
        return;
      }
      const url = req.url();
      const type = req.resourceType();
      const blocked =
        ALWAYS_BLOCK_TYPES.has(type) ||
        (CONSTANTS.PROXY_BLOCK_IMAGES && type === 'image') ||
        BLOCK_HOSTS.some((h) => url.includes(h));
      try {
        if (blocked) req.abort();
        else req.continue();
      } catch {
        // Request already handled/destroyed — safe to ignore.
      }
    });

    // (A/D) Start navigation but DON'T block on its lifecycle — heavy SPAs may
    // never reach 'load'/'domcontentloaded'. We let it run in the background
    // (timeout swallowed) and instead gate on real content appearing below, so
    // we proceed the moment the page is usable instead of waiting out the clock.
    page
      .goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: CONSTANTS.PROXY_RENDER_TIMEOUT_MS })
      .catch((err) => logger.warn(`Proxy nav lifecycle not reached for ${pageUrl}: ${err.message}`));

    // (A) Wait for *meaningful* content rather than a lifecycle event: enough
    // visible text + links, or many repeated card-like blocks. Resolves as soon
    // as the SPA paints, so fast sites are fast and slow ones don't hard-fail.
    const contentAppeared = await page
      .waitForFunction(
        () => {
          const b = document.body;
          if (!b) return false;
          const text = (b.innerText || '').trim();
          const anchors = document.querySelectorAll('a[href]').length;
          const cards = document.querySelectorAll(
            '[class*=card],[class*=product],[class*=listing],[class*=item],article,li',
          ).length;
          return (text.length > 200 && anchors >= 3) || cards >= 10;
        },
        { timeout: CONSTANTS.PROXY_CONTENT_WAIT_MS, polling: 400 },
      )
      .then(() => true)
      .catch(() => false);

    // Dismiss cookie/consent banners + modal overlays and unlock scroll BEFORE
    // scrolling, so the lazy-load scroll works and the snapshot isn't covered.
    await dismissOverlays(page);

    // Gently scroll through the page to trigger lazy-loaded cards/images (this
    // sets <img src>/data-src so the user's browser loads them later via
    // <base href>), then return to the top so the snapshot looks initial.
    // Capped at a fixed number of steps so very tall listings don't stall here.
    await page
      .evaluate(async () => {
        const step = Math.max(400, window.innerHeight * 0.9);
        const MAX_STEPS = 25;
        let steps = 0;
        for (let y = 0; y < document.body.scrollHeight && steps < MAX_STEPS; y += step) {
          window.scrollTo(0, y);
          steps += 1;
          await new Promise((r) => setTimeout(r, 120));
        }
        window.scrollTo(0, 0);
      })
      .catch(() => {});
    await new Promise((r) => setTimeout(r, CONSTANTS.PROXY_SETTLE_MS));

    // Keep waiting until the DOM stops growing, so sections that hydrate a beat
    // after the main content (e.g. a JS-rendered "Specifications" block) are
    // captured. Resolves early when stable, so this rarely adds wall-clock.
    await waitForDomStable(page, { maxMs: CONSTANTS.PROXY_STABILIZE_MS });

    // Re-run after the settle delay to catch delayed pop-ups (newsletter modals,
    // late-loading consent banners) that appear a beat after first paint.
    await dismissOverlays(page);

    const raw = await page.evaluate(() => document.documentElement.outerHTML);
    const finalUrl = page.url();
    const title = await page.title().catch(() => '');

    // (D) Only fail when the page is genuinely empty (e.g. a throughput wall
    // like 101lab where the bundle never arrived). A partial-but-usable render
    // still succeeds, with a warning.
    const bodyText = await page
      .evaluate(() => (document.body && document.body.innerText ? document.body.innerText.trim().length : 0))
      .catch(() => 0);
    if (!contentAppeared && bodyText < 50) {
      throw new Error(
        'Page produced no renderable content within the time budget ' +
          '(likely a very slow origin or a bot wall). Try increasing ' +
          'PROXY_CONTENT_WAIT_MS, or scrape this site via its API instead.',
      );
    }
    if (!contentAppeared) {
      logger.warn(`Proxy render for ${pageUrl} captured a partial page (content heuristic not fully met).`);
    }

    const html = injectStudio(stripUnsafe(raw), finalUrl);
    setCachedRender(pageUrl, { html, finalUrl, title });
    return { html, finalUrl, title };
  } finally {
    await page.close().catch(() => {});
    // Keep the shared browser alive for the next render.
  }
}

export default { renderProxyPage, closeProxyBrowser };
