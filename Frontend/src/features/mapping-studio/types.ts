import type { DomProfile, ScrapeMode } from '@/types/api';

/** A message coming FROM the injected script in the proxied iframe. */
export interface PickedMessage {
  source: 'scraper-iframe';
  type: 'picked';
  field: string;
  multi: boolean;
  count: number;
  payload: {
    selector: string;
    xpath: string | null;
    text: string;
    html: string;
    attrs: Record<string, string>;
    imgSrc: string | null;
    href: string | null;
    tag: string;
  };
  /** Full current pick-set for the field (used for multi-image selection). */
  items: Array<{ selector: string; imgSrc: string | null; classes?: string[] }>;
}

export interface ReadyMessage {
  source: 'scraper-iframe';
  type: 'ready';
  url: string;
  title: string;
}

export interface HoverMessage {
  source: 'scraper-iframe';
  type: 'hover';
  text: string;
  tag: string;
}

export interface NavigateMessage {
  source: 'scraper-iframe';
  type: 'navigate';
  url: string;
}

export type IframeMessage = PickedMessage | ReadyMessage | HoverMessage | NavigateMessage;

export type FieldType = 'text' | 'html' | 'attr' | 'number' | 'table' | 'keyValueTable';

/** One mapped detail field (title, price, description, or custom). */
export interface FieldDraft {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  /** True for the always-present built-ins (title/price/description). */
  builtin: boolean;
  selector?: string;
  xpath?: string;
  sampleValue?: string;
}

export interface ImagePick {
  selector: string;
  src: string | null;
  classes?: string[];
}

export interface MappingDraft {
  listingUrl: string;
  sampleProductUrl: string;

  // Listing-level (Step "Listing")
  productLinkSelector?: string;
  nextSelector?: string;

  // Detail-level (Step "Fields")
  fields: FieldDraft[];
  images: ImagePick[];

  // Meta (Step "Review")
  profileName: string;
  domain: string;
  urlPattern: string;
  productUrlPattern?: string;
  downloadImages: boolean;
  scrapeMode: ScrapeMode;
  /** Max new products to scrape per run (null = All / no cap). */
  scrapeLimit: number | null;
  /** Profile-level currency for prices (not a DOM-picked field). */
  priceCurrency: string;

  /**
   * How product URLs are found. 'listing' (default) = crawl listing pages with
   * pagination; 'sitemap' = read the site's XML sitemap(s); 'auto' = try the
   * sitemap, fall back to listing pagination if it finds nothing.
   */
  discoveryMode: 'listing' | 'sitemap' | 'auto';
  /** Optional explicit sitemap URL (used when discoveryMode is sitemap/auto). */
  sitemapUrl?: string;
  /** Category URL regexes picked in the Sitemap step (stored for future use). */
  categoryPatterns?: string[];
}

export const BUILTIN_FIELDS: FieldDraft[] = [
  { key: 'title', label: 'Title', type: 'text', required: true, builtin: true },
  { key: 'price', label: 'Price', type: 'text', required: false, builtin: true },
  { key: 'description', label: 'Description', type: 'html', required: false, builtin: true },
  { key: 'manufacturer', label: 'Manufacturer', type: 'text', required: false, builtin: true },
  { key: 'model', label: 'Model', type: 'text', required: false, builtin: true },
  { key: 'year', label: 'Year', type: 'text', required: false, builtin: true },
  { key: 'condition', label: 'Condition', type: 'text', required: false, builtin: true },
  { key: 'serial', label: 'Serial Number', type: 'text', required: false, builtin: true },
  { key: 'category', label: 'Category', type: 'text', required: false, builtin: true },
  { key: 'subcategory', label: 'Subcategories', type: 'text', required: false, builtin: true },
];

/** Currency options for the profile-level price currency dropdown. */
export const CURRENCY_OPTIONS = ['USD', 'EUR', 'THB', 'GBP', 'JPY', 'CNY', 'INR'];

export function emptyDraft(): MappingDraft {
  return {
    listingUrl: '',
    sampleProductUrl: '',
    fields: BUILTIN_FIELDS.map((f) => ({ ...f })),
    images: [],
    profileName: '',
    domain: '',
    urlPattern: '',
    downloadImages: true,
    scrapeMode: 'auto',
    scrapeLimit: 20,
    priceCurrency: 'USD',
    discoveryMode: 'listing',
  };
}

/** A pseudo-field key used to arm picking of the combined "images" target. */
export const IMAGES_KEY = '__images';
/** Pseudo-keys for listing-level targets. */
export const PRODUCT_LINK_KEY = '__productLink';
export const NEXT_KEY = '__next';

/**
 * Build a single CSS selector that matches every picked image — generalized so
 * it captures the whole gallery (main + all thumbnails), not just the clicked
 * thumbnails. Prefers a class shared by ALL picks (e.g. `img.gallery-image`).
 */
export function combineImageSelector(images: ImagePick[]): string | undefined {
  if (!images.length) return undefined;

  // 1) A class common to every picked image → matches the whole gallery.
  const lists = images.map((i) => i.classes || []);
  if (lists.every((l) => l.length)) {
    const generic = /^(lazy|loaded|loading|active|selected|img|image|thumb|thumbnail|d-block|w-100)$/i;
    const common = lists[0]
      .filter((c) => lists.every((l) => l.includes(c)))
      .filter((c) => !generic.test(c));
    if (common.length) return 'img.' + common.slice(0, 2).join('.');
  }

  // 2) Fallback: a shared `img.<class>` selector, else comma-join raw selectors.
  const selectors = images.map((i) => i.selector).filter(Boolean);
  if (!selectors.length) return undefined;
  const classSelectors = selectors.filter((s) => /^img\.[\w-]+$/.test(s));
  if (classSelectors.length === selectors.length) {
    const unique = Array.from(new Set(classSelectors));
    if (unique.length === 1) return unique[0];
  }
  return Array.from(new Set(selectors)).join(', ');
}

/** Derive a path-only product URL pattern (regex) from the full urlPattern. */
export function productUrlPatternFromUrlPattern(urlPattern: string): string | undefined {
  // urlPattern looks like  https://host\.com/path/\d+  → keep from the path on.
  const m = urlPattern.match(/^https?:\\?\/\\?\/[^/]+(\/.*)$/);
  return m ? m[1] : undefined;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * From a single product detail URL, derive GENERALIZED selectors/patterns that
 * match ALL products of the same shape — not just the one that was clicked.
 *
 *   https://www.labassets.com/listings/5863138-used-fedegari-...   →
 *     linkSelector       a[href*="/listings/"]
 *     productUrlPattern  /listings/\d+[^/]*
 *     urlPattern         https://www\.labassets\.com/listings/\d+[^/]*
 *
 * The last path segment (the slug/id) is treated as the dynamic part.
 */
export function generalizeProductLink(href: string): {
  linkSelector: string;
  productUrlPattern: string;
  urlPattern: string;
} | null {
  try {
    const u = new URL(href);
    const segs = u.pathname.split('/').filter(Boolean);
    if (!segs.length) return null;
    const last = segs[segs.length - 1];
    const prefixSegs = segs.slice(0, -1);
    const prefixPath = '/' + (prefixSegs.length ? prefixSegs.join('/') + '/' : '');
    // Dynamic last segment: numeric-id slugs → \d+[^/]*, otherwise any segment.
    const lastRegex = /^\d/.test(last) ? '\\d+[^/]*' : '[^/]+';
    const escPrefix = escapeRegex(prefixPath);
    const escOrigin = escapeRegex(u.origin);
    return {
      linkSelector: `a[href*="${prefixPath}"]`,
      productUrlPattern: `${escPrefix}${lastRegex}`,
      urlPattern: `${escOrigin}${escPrefix}${lastRegex}`,
    };
  } catch {
    return null;
  }
}

/**
 * Build a robust "Next page" selector from a picked pagination element, biased
 * toward attribute/role hints (rel/aria/class) that survive across pages, with
 * common fallbacks appended. Falls back to the raw selector when nothing matches.
 */
export function generalizeNextSelector(payload: {
  selector: string;
  attrs: Record<string, string>;
  text: string;
}): string {
  const fallbacks = [
    'a[rel="next"]',
    'a[aria-label*="next" i]',
    'button[aria-label*="next" i]',
    'li.page-item:last-child > a.page-link',
    '.pagination .next:not(.disabled) a',
    'li.next:not(.disabled) a',
  ];
  const hints: string[] = [];
  const { attrs } = payload;
  if (attrs.rel === 'next') hints.push('a[rel="next"]');
  if (/next/i.test(attrs['aria-label'] || '')) hints.push('[aria-label*="next" i]');
  const cls = (attrs.class || '').split(/\s+/).find((c) => /next/i.test(c));
  if (cls) hints.push(`.${cls}`);
  // De-dupe while preserving order; always keep fallbacks as a safety net.
  return Array.from(new Set([...hints, payload.selector, ...fallbacks])).join(', ');
}

/** Assemble the final DOM profile to POST to /api/save-profile. */
export function buildProfile(draft: MappingDraft, now: string): DomProfile {
  const slug = (draft.domain || 'site').replace(/[^a-z0-9]+/gi, '').toLowerCase();
  const fields: DomProfile['fields'] = {};
  for (const f of draft.fields) {
    if (!f.selector) continue;
    fields[f.key] = {
      selector: f.selector,
      type: f.type,
      required: f.required,
      ...(f.xpath ? { xpath: f.xpath } : {}),
      ...(f.sampleValue ? { sampleValue: f.sampleValue.slice(0, 200) } : {}),
    };
  }
  return {
    profileId: `profile_${slug}`,
    profileName: draft.profileName || `${draft.domain} Product Scraper`,
    domain: draft.domain,
    urlPattern: draft.urlPattern,
    source: 'dom',
    downloadImages: draft.downloadImages,
    scrapeMode: draft.scrapeMode,
    scrapeLimit: draft.scrapeLimit,
    priceCurrency: draft.priceCurrency,
    ...(draft.sampleProductUrl ? { sampleProductUrl: draft.sampleProductUrl } : {}),
    listingUrls: draft.listingUrl ? [draft.listingUrl] : [],
    ...(draft.discoveryMode && draft.discoveryMode !== 'listing'
      ? {
          discovery: {
            mode: draft.discoveryMode,
            ...(draft.sitemapUrl ? { sitemapUrl: draft.sitemapUrl } : {}),
            ...(draft.productUrlPattern ? { productUrlPattern: draft.productUrlPattern } : {}),
            ...(draft.categoryPatterns?.length ? { categoryPatterns: draft.categoryPatterns } : {}),
          },
        }
      : {}),
    pagination: {
      ...(draft.productLinkSelector ? { productLinkSelector: draft.productLinkSelector } : {}),
      ...(draft.productUrlPattern ? { productUrlPattern: draft.productUrlPattern } : {}),
      ...(draft.nextSelector ? { nextSelector: draft.nextSelector } : {}),
      ...(draft.productLinkSelector ? { waitForSelector: draft.productLinkSelector } : {}),
    },
    fields,
    selectors: {
      ...(combineImageSelector(draft.images) ? { images: combineImageSelector(draft.images) } : {}),
      waitForSelector: fields.title?.selector || 'h1',
      timeout: 15000,
    },
    createdAt: now,
    updatedAt: now,
    usageCount: 0,
  };
}

/** Inverse of buildProfile: hydrate an editable draft from a saved profile. */
export function profileToDraft(config: DomProfile): MappingDraft {
  const f = config.fields || {};
  const builtinKeys = new Set(BUILTIN_FIELDS.map((b) => b.key));

  // Built-ins first (so the panel order is stable), pre-filled from saved fields.
  const fields: FieldDraft[] = BUILTIN_FIELDS.map((b) => {
    const saved = f[b.key];
    return saved
      ? {
          ...b,
          type: (saved.type as FieldType) || b.type,
          required: saved.required ?? b.required,
          selector: saved.selector,
          xpath: saved.xpath,
          sampleValue: saved.sampleValue,
        }
      : { ...b };
  });
  // Then any custom fields saved on the profile.
  for (const [key, v] of Object.entries(f)) {
    if (builtinKeys.has(key)) continue;
    fields.push({
      key,
      label: key,
      type: (v.type as FieldType) || 'text',
      required: !!v.required,
      builtin: false,
      selector: v.selector,
      xpath: v.xpath,
      sampleValue: v.sampleValue,
    });
  }

  const pag = config.pagination || {};
  const imagesSel = config.selectors?.images;
  return {
    listingUrl: config.listingUrls?.[0] || '',
    sampleProductUrl: config.sampleProductUrl || '',
    productLinkSelector: pag.productLinkSelector,
    nextSelector: pag.nextSelector,
    fields,
    images: imagesSel ? [{ selector: imagesSel, src: null }] : [],
    profileName: config.profileName || '',
    domain: config.domain || '',
    urlPattern: config.urlPattern || '',
    productUrlPattern: pag.productUrlPattern,
    downloadImages: config.downloadImages ?? true,
    scrapeMode: config.scrapeMode || 'auto',
    scrapeLimit: config.scrapeLimit ?? null,
    priceCurrency: config.priceCurrency || 'USD',
    discoveryMode: config.discovery?.mode ?? 'listing',
    sitemapUrl: config.discovery?.sitemapUrl,
    categoryPatterns: config.discovery?.categoryPatterns,
  };
}

/** Suggested profile filename. */
export function suggestFileName(domain: string): string {
  const slug = (domain || 'site').replace(/[^a-z0-9]+/gi, '').toLowerCase();
  return `profile_${slug}.json`;
}
