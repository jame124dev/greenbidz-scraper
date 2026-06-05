# GreenBidz Scraper — Integration Plan

How this scraper plugs into the main **GreenBidz** marketplace
(101lab.co / recycle / 101it / machines) and what it does for sellers.

---

## 1. The problem we're solving

GreenBidz is a marketplace. On the main site, products are created through an API.
But **sellers already have their own small websites** full of products (e.g.
`labassets.com` with 300–800 lab items). Today a seller must **re-type every
product by hand** into GreenBidz — title, price, specs, images — which is slow,
error-prone, and a barrier to onboarding big catalogs.

**This scraper removes the manual step.** A seller (or a GreenBidz agent) maps a
seller's website once, the scraper extracts every product, and we **push them
straight into the main GreenBidz product database** via the existing
`create-product-direct` API — then keeps importing **new products automatically**
on a schedule.

```
Seller's website            This scraper (subproject)              Main GreenBidz
(labassets.com, …)          Frontend UI + Backend API + cron       api.101recycle.greenbidz.com
┌──────────────┐  visual    ┌───────────────────────────┐  POST   ┌─────────────────────────┐
│ product pages│ ─mapping─▶ │ discover → scrape (batch)  │ ──────▶ │ /api/v1/wp/             │
│ (HTML)       │  + cron    │ → normalize → publish      │ payload │ create-product-direct   │
└──────────────┘            │ (MySQL: products)          │ +images │ (createProductV2)       │
        ▲                   └───────────────────────────┘         │ → WooCommerce product   │
        └──── re-crawls on a schedule to catch NEW products ──────┘ → auto-translate / media │
                                                                   └─────────────────────────┘
```

---

## 2. The integration point (already exists on main)

**Endpoint:** `POST https://api.101recycle.greenbidz.com/api/v1/wp/create-product-direct?lang=en`
**Handler:** `createProductV2`.

What we lean on:

- Creates (or **updates**, if `product_id` is passed) a WooCommerce/WordPress
  product with all meta (brand, model, serial, condition, price, …).
- **Downloads images server-side from `image_urls`** — the scraper just sends the
  remote image URLs it already captured; no upload needed.
- **First image = featured**, the rest = gallery (matches our "main image first").
- **Auto-translates** title + description into EN/ZH/JA/TH (fire-and-forget).
- Sends admin/seller **notifications**.
- Routes the product to the right marketplace via `allowed_sites` / `site_type`
  (`machines` / `recycle` / `101it` / `LabGreenbidz`).

> Our job is just: **discover → scrape → map fields → POST**. Media, translation,
> and taxonomy are handled by the main side.

---

## 3. Field mapping: scraper → `create-product-direct`

### A. Mapped from each scraped product
| Scraper field | API body field | Notes |
|---|---|---|
| `title` | `product_title` | required |
| `description` (html) | `product_content` | |
| `price` (number) | `price_per_unit` (or `price`) | set `price_now_enabled=true` |
| `priceRaw` currency (£/$/€) | `price_currency` | parse from raw price; fallback to profile default |
| `brand` | `brand` | also stored as `manufacturer` by the API |
| `model` | `model` | |
| `serial` | `serial_number` | |
| `condition` | `item_condition` | array (e.g. `["Used"]`) |
| custom `grade` / `weight` / `dimensions` | `item_grade` / `weight_per_unit` / `dimensions` | optional |
| `images_remote_urls[]` | `image_urls[]` | **[0] = featured, rest = gallery** |
| `product_url` | (kept locally) | used for dedup, not sent |

### B. From the profile's **publish config** (set once per seller/site, not scraped)
| Config | API body field | Notes |
|---|---|---|
| seller's GreenBidz user id | `post_author_id` | **required** — attributes the product to the seller |
| seller name / company | `seller_name`, `seller_company` | |
| target marketplace | `allowed_sites` + `site_type` | `LabGreenbidz` for lab gear, etc. |
| default category | `product_category_ids` + `category_name` | per-product mapping optional |
| currency / price format | `price_currency`, `price_format` | |
| product type / visibility | `product_type` (default `simple`), `sellerVisible` (default true) | |
| default quantity / location | `quantity`, `location` | |

### C. Dedup (create vs update)
After a successful push, store the returned `product_id` on the scraper's product
row as `greenbidz_product_id`. On a later re-scrape/re-publish of the same
`product_url`, send that id as `product_id` → the API **updates** instead of
creating a duplicate.

---

## 4. Image handling
The scraper already captures the **full gallery** (shared-class selector + lazy
scroll + `data-src`, main image first). We send those URLs as `image_urls[]`;
`createProductV2` downloads them, makes the first the featured image and the rest
the gallery. **No local download or GCS upload needed** from our side
(`downloadImages=false` for publish-only profiles).

---

## 5. Large-dataset scraping via cron-job (the core mechanism)

A seller site can hold **hundreds to thousands** of products. Scraping them all in
one shot is heavy (each product detail = a Puppeteer page load, ~3–5 s) and risks
rate-limiting / IP blocks on the seller's site. So we **never bulk-scrape at once
— we drain the catalog in small batches on a schedule.**

How it works (built on what already exists):

1. **Discovery is cheap and complete.** One listing crawl (with pagination +
   auto-scroll) collects **every** product URL and records each as a lightweight
   *stub* row (`scraped = FALSE`). No detail pages are fetched yet. Recording is
   capped per site by `MAX_PRODUCTS_PER_PROFILE` (default 1000).
2. **Detail scraping is batched.** Each run scrapes only up to the profile's
   **`scrapeLimit`** (e.g. 20) unscraped products, flips them to `scraped = TRUE`,
   and leaves the rest queued.
3. **The cron scheduler drains the queue over time.** A profile marked
   **"with job"** (`scrapeMode: auto`) is crawled every `CRAWL_INTERVAL_HOURS` by
   the node-cron scheduler. Each tick = discover (catch new) + scrape one batch.

**Worked example** — 800 products, `scrapeLimit = 50`, interval = 2 h:
`ceil(800 / 50) = 16` batches → fully scraped in ~32 h, gently, ~50 page loads
every 2 hours instead of 800 at once.

**Tunables (per-profile or `.env`):**
- `scrapeLimit` — batch size per run (10/20/50/100/All).
- `CRAWL_INTERVAL_HOURS` — how often the cron tick fires (lower = faster drain).
- `MAX_PRODUCTS_PER_PROFILE` — hard cap on rows recorded per site.
- `MAX_RETRIES` / `RETRY_DELAY_MS` — resilience against transient failures.
- Concurrency guard: the scheduler **skips a tick if the previous run is still
  going**, so batches never overlap.

Manual control still exists alongside cron: **"Scrape new"** on the Profiles page
and **"Save & Scrape now"** in the Studio run a batch on demand with the live
animated progress + Stop button.

---

## 6. Auto-scraping NEW products when they appear on the seller's site

Sellers keep adding products. We want those to flow into GreenBidz **without
anyone re-running anything** — the recurring crawl handles it.

How new products are detected (incremental crawl):

- Every cron tick **re-crawls the seller's listing** and diffs the discovered
  URLs against the `products` table:
  - URL already known → **skipped** (not re-scraped).
  - URL not in the DB → **brand-new** → recorded as a stub and scraped in this or
    the next batch.
- This is the existing discovery model (`recordAndSelect` computes *brand-new vs
  seen*; `ONLY_NEW_PRODUCTS=true` scrapes only the unscraped). So **a product that
  appears on the seller's site after the initial import is picked up
  automatically** on the next tick.
- **Auto-publish (optional):** with `publish.enabled` + `publish.autoPublish`, a
  newly-scraped product is pushed to GreenBidz right after it's scraped — so a new
  item on the seller's site becomes a live GreenBidz listing within one interval,
  hands-off.

Notes & tuning for fast pickup:
- Most seller sites list **newest first**, so new items land on page 1 — discovery
  catches them quickly even if we limit pages on routine ticks.
- For near-real-time pickup, lower `CRAWL_INTERVAL_HOURS` (e.g. hourly) for that
  profile, or trigger a run via webhook if the seller's site can notify us.
- Removed/sold items: a later enhancement can mark products missing from the
  listing as inactive (and optionally unpublish on GreenBidz).

---

## 7. End-to-end flow (one pass)

1. **Map the site once** in the Studio (fields, product link, pagination) → save
   profile.
2. **Set publish config** on the profile (seller `post_author_id`, marketplace,
   category, currency) and choose **with-job** mode + `scrapeLimit`.
3. **Initial import** drains the whole catalog batch-by-batch via cron (or manual
   "Scrape new").
4. **Review** scraped products (edit if needed) — or skip with auto-publish.
5. **Publish** to GreenBidz (per product, bulk, or automatic) → each product gets
   a `greenbidz_product_id` + **Published** badge.
6. **Ongoing:** every interval the crawl catches **new** products and (optionally)
   auto-publishes them; re-scrapes update existing listings (no duplicates).

---

## 8. What we build (single implementation)

**Backend**
- **Publish config on the profile** — a `publish` block:
  ```jsonc
  "publish": {
    "enabled": true,
    "autoPublish": false,                  // push new products automatically after scrape
    "apiUrl": "https://api.101recycle.greenbidz.com/api/v1/wp/create-product-direct",
    "marketplace": "LabGreenbidz",         // → allowed_sites + site_type
    "postAuthorId": 12345,                  // seller's GreenBidz user id (required)
    "sellerName": "...", "sellerCompany": "...",
    "defaultCategoryId": 678, "defaultCategoryName": "Lab Equipment",
    "currency": "GBP", "priceFormat": "fixed",
    "productType": "simple",
    "defaultQuantity": 1, "defaultLocation": "United Kingdom"
  }
  ```
- **Payload mapper** (`Backend/publish/payload-mapper.js`) — `(product,
  profile.publish) → create-product-direct body` (price parse, condition→array,
  images→`image_urls`, marketplace normalization mirroring
  `normalizeMarketplaceType`). Supports a **dry-run** mode that logs the payload
  without posting.
- **Publish client/service** (`Backend/publish/greenbidz-client.js`) —
  `publishProduct(id)`: build payload → POST (with auth) → store result
  (`greenbidz_product_id`) → on re-publish send `product_id` to update.
- **Hook into the crawl** — when `publish.autoPublish`, call `publishProduct`
  right after a successful scrape inside the batch loop (so cron auto-publishes
  new items).
- **DB columns on `products`:** `published`, `published_at`,
  `greenbidz_product_id`, `publish_error`, `publish_payload` (last sent).
- **Endpoints:** `POST /api/products/:id/publish`, bulk `POST /api/publish`
  (job-tracked, reuses the progress/Stop UI), and extend `GET /api/products` with
  publish status.

**Frontend**
- Products page: **Publish** button per row + bulk select; status badges
  (`scraped` / `published` / `publish error`); link to the live GreenBidz listing.
- Profile / Studio: **Publish settings** section (seller, marketplace, category,
  currency, auto-publish toggle) + **with-job** + `scrapeLimit`.
- Reuse the animated progress screen for bulk publish.

**Config & auth (`.env`)**
- `GREENBIDZ_API_URL`, `GREENBIDZ_API_TOKEN` (if required), default
  marketplace/currency. Per-profile `publish.postAuthorId` ties products to the
  seller.

**Build checklist (order, not phases):**
1. Publish config + mapper (pure, testable) → dry-run logs the exact payload.
2. Publish client against a staging/test product → confirm mapping on one real item.
3. DB columns + single-product publish endpoint + Products UI status.
4. Bulk publish + auto-publish hook in the cron batch loop.
5. Tune cron cadence / batch size for the first seller (labassets → LabGreenbidz).

---

## 9. Open questions (confirm before building)
1. **Auth** — does `create-product-direct` need a token/API key or IP allowlist?
   What header? (Not visible in the handler.)
2. **Seller id** — how do we get each seller's `post_author_id`? Manual per
   profile, or a lookup endpoint?
3. **Category mapping** — scraped category text → GreenBidz `product_category_ids`:
   one default per profile, a mapping table, or manual per product?
4. **Marketplace** — always one per profile (labassets → `LabGreenbidz`), or per
   product?
5. **Currency** — trust the scraped symbol, or force the profile default?
6. **Request format** — `application/json` (with `image_urls[]`) or
   `multipart/form-data`? (Handler reads both.)
7. **Approval** — auto-publish new items, or always require human review first?

---

## 10. How this helps sellers (the payoff)
- **Onboard a whole catalog hands-off** — hundreds of products imported in
  scheduled batches, no manual re-entry.
- **Stays current automatically** — new products on the seller's site flow into
  GreenBidz on the next crawl; re-scrapes update existing listings (no duplicates).
- **Accurate, complete data** — title, price, brand/model/serial, condition, and
  the full image gallery, straight from the seller's own pages.
- **Free multilingual reach** — the main API auto-translates each product to
  EN/ZH/JA/TH.
- **Right marketplace, right seller** — products land under the seller's account
  on the correct GreenBidz vertical.
- **Gentle & safe at scale** — small cron batches + a per-site cap avoid
  hammering the seller's site or flooding the marketplace; optional review keeps
  quality high.
