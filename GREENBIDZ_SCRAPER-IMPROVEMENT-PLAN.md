# Greenbidz-Product-Scraper — Overview, Current Limitations & Improvement Plan

* This document summarizes what the system does today, the
three key limitations we have identified, and the recommended solutions. We plan to
implement the improvements one at a time, starting with the highest-impact item.*

---

## 1. Project overview

Product-Scraper is a tool that automatically collects product listings from external
websites and publishes them to the main GreenBidz marketplace. It has two parts:

- **Admin dashboard** — where the team sets up sites, builds scraping rules visually,
  runs and schedules jobs, browses collected products, and pushes them to the main
  site.
- **Backend engine** — the automation that visits the source websites, reads each
  product (title, price, description, images), stores it, and sends it to the main
  site.

**How a site is set up:** for each source website, the team creates a **profile** — a
saved set of rules describing where the product listings are and how to read each
product. The system then runs these profiles automatically on a schedule.

---

## 2. How it works today

1. **Find products** — the system opens a site's listing page(s) and moves through
   the "Next" pages, collecting every product link.
2. **Identify new ones** — it compares the links against what it already has and
   keeps only the new products.
3. **Read each product** — it opens each new product page and extracts the title,
   price, description, and images.
4. **Store** — the product is saved to the database.
5. **Sync to main site** — the team selects products and sends them to the main
   GreenBidz marketplace. New products are created; previously-sent products are
   updated in place (no duplicates).

The schedule runs each site on its own interval and automatically picks up newly
listed products over time.

---

## 3. Key limitations in the current system

### Problem 1 — Performance at scale (many sites, thousands of products)

As the number of sites and products grows (e.g. tens of sites and 5,000–10,000+
products), the system can struggle to keep up.

- It processes work **one item at a time** — one site, then the next, then the next —
  rather than several in parallel. Large workloads take a long time to complete.
- Each run re-scans a site's listing pages in full just to spot new products, so this
  scanning cost keeps growing as catalogs get bigger.
- If one run takes longer than the gap between scheduled runs, the next run is
  skipped, and the system gradually falls behind.

**In short:** collecting *new* products works, but the engine needs to do more work
in parallel and scan more efficiently to handle large catalogs comfortably.

### Problem 2 — Changes on the source site are not reflected on the main site

Today the system is essentially **"copy once and forget."**

- Once a product has been collected, it is never re-checked. If the source website
  later changes a product's **price or description**, the system does not notice.
- As a result, the main GreenBidz site can show **outdated prices/details** for
  products that have changed at the source.

**In short:** there is no mechanism to detect changes on already-collected products
and update them on the main site. (The ability to *update* an existing product on the
main site already exists — what's missing is automatically detecting the change and
triggering the update.)

### Problem 3 — Different website structures / too many categories to set up by hand

Different source websites are organized very differently:

- Some show **all products on one page**.
- Some use **page numbers (pagination)**.
- Some are split into **many categories** — sometimes hundreds.
- Some use **infinite scroll / "load more"**, or other unusual layouts.

The current setup expects the team to point the system at specific listing pages. For
a site with hundreds of categories, this would mean manually listing every category —
which is impractical. When a site's structure can't be handled, that **entire site
gets left out**.

**In short:** the system needs to discover a site's product pages on its own, instead
of relying on the team to map every category and page manually.

---

## 4. Suggested solutions

### Solution 1 — Handle larger volumes reliably

- **Short term (tuning):** limit how much each site processes per run, stagger the
  schedules, and prefer faster data sources where a site provides them.
- **Longer term (capacity):** allow the engine to process **several sites at once**
  instead of one-by-one, and make listing scans **stop early** once they reach
  already-known products — so large catalogs are scanned far more efficiently.

### Solution 2 — Keep the main site up to date with source changes

1. **Record a "fingerprint"** of each product (based on its title, price, and
   description) so any later change can be detected.
2. **Re-check products periodically** on a gentle schedule — without slowing down the
   collection of new products.
3. **Detect changes** by comparing the new fingerprint to the saved one, and flag the
   product as **"changed."**
4. **Update the main site automatically** for changed products (reusing the existing
   update capability). Optionally, changes can first appear on an **"Approve changes"**
   screen so the team can confirm price updates before they go live.

> Note: updating product **images** on an existing listing is a separate enhancement,
> handled in a later phase.

### Solution 3 — Automatically discover a site's products (one setup per site)

Instead of mapping every category with a profile by hand, the system should **explore the site and
collect every product page on its own.** Recommended approach, in order of priority:

1. **Site map first (biggest win):** most websites publish a built-in list of all
   their pages (a "sitemap"). Reading this can capture **every product at once**,
   bypassing categories and pagination entirely — fast and reliable.
2. **Automatic category discovery:** for sites without a sitemap, point the system at
   a single starting page; it finds the category links itself and works through each
   one — no need to list categories manually.
3. **Pagination & infinite scroll:** continue to handle page numbers and strengthen
   support for "load more" / scroll-to-load pages.

The result: **one simple setup per website** that adapts to all-on-one-page,
paginated, and category-based sites alike — so far fewer sites get left out.

---

## 5. Recommended implementation order

We will implement these **one at a time**, testing each against a real website before
moving to the next.

| Order | Improvement | Why this order |
|:---:|---|---|
| **1** | **Automatic discovery — site map** (Solution 3) | Highest impact, lowest risk; immediately unlocks sites we currently can't handle. |
| **2** | **Change detection + review screen** (Solution 2) | Keeps the main site accurate; verify detection before turning on automatic updates. |
| **3** | **Automatic updates of changed products** (Solution 2) | Enabled once change detection is trusted. |
| **4** | **Category discovery + infinite scroll** (Solution 3) | Covers sites that don't publish a site map. |
| **5** | **Higher-volume performance** (Solution 1) | Tune now; add parallel processing as volumes grow. |

*This order is a recommendation and can be adjusted based on priorities.*
