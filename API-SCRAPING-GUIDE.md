# API Scraping Guide (Option E) — for heavy SPAs & slow origins

> **Status:** Documentation only — to implement *later*. The runtime code for this
> already exists; this guide explains how to use it. No code changes required to
> follow it, only a new profile JSON per site.

## When to use this instead of the visual Mapping Studio

Use **API mode** when a site is one of:

- A **React/SPA** that renders nothing useful into static HTML (e.g. `101lab.co`,
  `101it.co`). DOM scraping finds no product links and no price.
- A **throughput wall** — the origin serves assets so slowly that the headless
  renderer can never finish (measured: `101lab.co` ≈ **2.3 KB/s** with a **6.1 MB**
  JS bundle → ~45 min to load). No render strategy (A–D) can fix this; the proxy
  renderer will return the graceful "no renderable content" error.

The fix in both cases is the same: **skip the browser entirely and fetch the
site's own JSON API**, which is what its frontend calls anyway. This is faster
*and* more reliable than headless scraping.

## What already exists in this codebase (no new code needed)

| Piece | File | Role |
|---|---|---|
| API auto-detector | [Backend/detectors/api-detector.js](Backend/detectors/api-detector.js) | Renders the listing once, watches XHR/fetch JSON, guesses the `api` profile block |
| Profile matcher | [Backend/detectors/url-pattern-matcher.js](Backend/detectors/url-pattern-matcher.js) | `findApiProfileForListing()` — picks an `"source":"api"` profile for a listing URL |
| Runtime crawler | [Backend/scrapers/api-client.js](Backend/scrapers/api-client.js) | `crawlListingApi()` — pages through the JSON API, maps records to products |
| Crawl orchestration | [Backend/scheduler/job-runner.js](Backend/scheduler/job-runner.js) | `runApiCrawlForListing()` — API fast-path in the normal crawl cycle |
| Working example | [Backend/profiles/profile_101itco.json](Backend/profiles/profile_101itco.json) | A complete, real `"source":"api"` profile |

So enabling a new site = **writing one profile JSON**. The crawl cycle already
takes the API fast-path automatically when a matching `"source":"api"` profile
exists (see `job-runner.js` → `findApiProfileForListing` → `runApiCrawlForListing`).

## The API profile shape (annotated)

Based on the real `profile_101itco.json`:

```jsonc
{
  "profileName": "101lab.co Product Scraper",
  "domain": "101lab.co",
  // Regex matching individual PRODUCT detail URLs (for dedupe/identity).
  "urlPattern": "https://101lab\\.co/buyer-marketplace/\\d+",
  "source": "api",                 // ← opts into API mode
  "downloadImages": true,
  "profileId": "profile_101lab",
  "listingUrls": [
    "https://101lab.co/buyer-marketplace"   // ← what the scheduler crawls
  ],
  "api": {
    "listing": {
      "url": "https://<api-host>/api/v1/batch/fetch",  // the JSON endpoint
      "method": "GET",
      "headers": {},                 // add auth/keys here if the API needs them
      "query": { "limit": 50, "lang": "en", "type": "101lab" }, // fixed params
      "pageParam": "page",           // query key used for pagination
      "startPage": 1,                // first page number
      "dataPath": "data",            // dot-path to the array of records in the body
      "idField": "batchNumber",      // unique id field within a record
      "productUrlTemplate": "https://101lab.co/buyer-marketplace/{id}", // {id} substituted
      "pagination": {
        "hasNextPath": "pagination.hasNextPage",   // bool → keep paging
        "totalPagesPath": "pagination.totalPages",
        "totalItemsPath": "pagination.totalItems"
      }
    },
    "fieldMap": {                    // maps record keys → normalised product fields
      "externalId": "batchNumber",
      "title": "title_en",
      "description": "description_en",
      "price": "value",
      "images": "firstProductImages"
    }
  }
}
```

Field paths support **dot-notation** (e.g. `"pagination.hasNextPage"`) via
`getByPath()` in `api-client.js`.

## Step-by-step: add a new API site (do this later)

### Step 1 — Find the JSON endpoint (manual, in your browser)
1. Open the listing page (e.g. `https://101lab.co/buyer-marketplace`) in Chrome.
2. DevTools → **Network** tab → filter **Fetch/XHR**.
3. Reload. Look for a request returning a JSON array of products (often a path
   like `/batch/fetch`, `/products`, `/listings`, `/search`).
4. Click it → **Response** tab → confirm it contains the product records.
5. Note: the request **URL**, **method**, **query params**, any **headers**
   (auth tokens?), and the **JSON shape** (where the array lives, field names).

### Step 2 — (Optional) Let the auto-detector pre-fill it
The project can guess most of this for you via `detectApiConfig()`
(`detectors/api-detector.js`). It's already wired into the detect endpoint in
[Backend/web/server.js](Backend/web/server.js) (the `source === 'api'` branch of
`/api/detect`). Run a detect against the listing URL and it returns a best-guess
`api` block + a sample record to confirm field names. Treat its output as a
starting point and verify against what you saw in Step 1.

> Caveat: if the origin is a throughput wall, the detector (which renders once)
> may itself be slow or time out. If so, build the profile by hand from Step 1.

### Step 3 — Write the profile JSON
- Copy `profiles/profile_101itco.json` to `profiles/profile_<domain>.json`.
- Fill in `api.listing.url`, `query`, `pageParam`, `dataPath`, `idField`,
  `productUrlTemplate`, `pagination.*`, and `fieldMap.*` from Steps 1–2.
- Set `domain`, `urlPattern`, `listingUrls`, `profileId` for the new site.

### Step 4 — Verify the mapping in isolation (before a full crawl)
Write a tiny throwaway script that imports the API client and dumps the first
page so you can confirm field mapping without touching the DB:

```js
// Backend/tmp-apicheck.mjs  (delete after)
import fs from 'node:fs';
import { crawlListingApi } from './scrapers/api-client.js';
const profile = JSON.parse(fs.readFileSync('./profiles/profile_101lab.json', 'utf8'));
const products = await crawlListingApi(profile, { maxPages: 1 });
console.log('count:', products.length);
console.log('first:', JSON.stringify(products[0], null, 2));
```
Run with `node tmp-apicheck.mjs`. Check `title`, `price`, `images`,
`externalId`, and `productUrl` look right. Adjust `fieldMap` until they do.

> (Confirm `crawlListingApi`'s exact options signature in
> [api-client.js](Backend/scrapers/api-client.js) before relying on `maxPages`.)

### Step 5 — Run it through the normal crawl
Once the profile is in `profiles/`, the existing crawl cycle picks it up
automatically: `runCrawlForListing()` → `findApiProfileForListing()` →
`runApiCrawlForListing()`. Trigger via the usual run path (`/api/run-profile`,
`/api/scrape`, or `npm run manual-run`). No code changes.

## Notes & gotchas
- **Auth:** if the API needs a token/cookie/API key, put it in
  `api.listing.headers`. Watch for short-lived tokens (may need refresh logic —
  that *would* be new code; flag it when you hit it).
- **Pagination styles:** this supports page-number (`pageParam` + `hasNextPath`/
  `totalPagesPath`). Offset/cursor pagination would need a small extension to
  `api-client.js`.
- **Rate limits:** `api-client.js` already wraps calls in `withRetry` (3 tries,
  1.5s delay). Add a delay between pages if the API is strict.
- **There may already be a `profile_101lab.json`** in `profiles/` — check it
  first; 101lab may be partially configured already.

## Why the proxy renderer (A–D) can't replace this
The Mapping Studio proxy renderer was upgraded (content-gated waits, resource
blocking, persistent cache, graceful partial capture) and now renders heavy
sites like `labassets.com` in ~7–10s. But it still **downloads the site in a
headless browser**. For a 2.3 KB/s origin that's fatal regardless of strategy —
only fetching the compact JSON API avoids the multi-MB render entirely.
