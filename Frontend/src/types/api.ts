// Shared types mirroring the backend REST responses (Backend/web/server.js +
// Backend/database/queries.js). Keep these in sync with the API contract.

export interface ProductCounts {
  total: number;
  scraped: number;
  unscraped: number;
}

export type ProfileSource = 'api' | 'dom';

/** A product's scrape scheduling mode (see plan §node_job change). */
export type ScrapeMode = 'auto' | 'manual';

export interface ProfileSummary {
  fileName: string;
  profileName?: string;
  domain?: string;
  source: ProfileSource;
  urlPattern?: string;
  /** auto = background cron crawls it; manual = only runs on demand. */
  scrapeMode?: ScrapeMode;
}

export interface PendingMapping {
  id: number;
  url_pattern: string;
  sample_url: string;
  auto_detected_fields: string | null;
  user_approved_fields: string | null;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  reviewed_at: string | null;
}

export interface StateResponse {
  counts: ProductCounts;
  profiles: ProfileSummary[];
  pending: PendingMapping[];
  listingUrls: string[];
}

export interface Product {
  id: number;
  external_id: string;
  product_url: string;
  profile_file_name: string | null;
  title: string | null;
  price: number | string | null;
  /** Currency for `price`, derived from the product's profile (default USD). */
  price_currency?: string;
  scraped: boolean;
  scraped_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
  is_active: boolean;
  images_local_paths: string[];
  /** Backend-served URLs for locally-downloaded images (/downloads/...). */
  images_local_urls?: string[];
  images_remote_urls: string[];
  last_error: string | null;
  /** Set once the product has been synced to the main site. */
  synced?: boolean;
  synced_at?: string | null;
  main_product_id?: number | null;
  /** Main-site batch id + marketplace synced to (used to build the public link). */
  main_batch_id?: number | null;
  main_site_type?: string | null;
  /** Seller the product was synced under (prefills a re-sync). */
  main_seller_id?: number | null;
  main_seller_name?: string | null;
  /** Public main-site listing URL, computed server-side when batch_id is known. */
  main_product_url?: string | null;
  // Present only on the single-product detail endpoint:
  description?: string | null;
  raw_data?: unknown;
  scrape_attempts?: number;
}

export interface ProductsResponse {
  counts: ProductCounts;
  /** Total products matching the current filter (for pagination). */
  total?: number;
  products: Product[];
}

export interface CrawlRun {
  id: number;
  listing_url: string;
  products_found: number | null;
  new_products: number | null;
  scraped_products: number | null;
  failed_products: number | null;
  crawl_duration_seconds: number | null;
  status: string | null;
  error_message: string | null;
  timestamp: string;
}

export interface CrawlHistoryResponse {
  history: CrawlRun[];
}

export interface ActiveCrawl {
  id: string;
  kind?: 'crawl' | 'rescrape';
  label?: string | null;
  listingUrls: string[];
  phase: string; // starting | discovering | scraping
  found: number;
  total: number; // selected to scrape this run
  scraped: number;
  failed: number;
  current: string | null; // url being scraped now
  startedAt: number | null; // epoch ms
}

export interface ActiveCrawlsResponse {
  active: ActiveCrawl[];
}

// ── Scheduler ────────────────────────────────────────────────────────────────
export interface SchedulerAutoProfile {
  fileName: string;
  profileName: string;
  domain: string | null;
  paused: boolean;
  /** This profile's own scrape cadence, in minutes. */
  intervalMinutes?: number;
  listingUrlCount: number;
  scrapeLimit: number | null;
  /** Most recent crawl across this profile's listing URLs (ISO), or null. */
  lastRunAt?: string | null;
  /** Next scheduled run (ISO) for this profile when active, else null. */
  nextRunAt?: string | null;
}

export interface SchedulerSummary {
  listings: number;
  new: number;
  scraped: number;
  failed: number;
  found: number;
  errors: number;
}

export interface SchedulerStatus {
  started: boolean;
  running: boolean; // schedule is active (not paused)
  paused: boolean;
  busy: boolean; // a crawl cycle is executing right now
  /** Base poll cadence (cron) — the scheduler checks this often; each profile
   *  runs on its own interval. */
  pollExpression: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastError: string | null;
  lastSummary: SchedulerSummary | null;
  activeProfileCount: number;
  autoProfiles: SchedulerAutoProfile[];
}

export interface ProfileListItem {
  fileName: string;
  profileId?: string;
  profileName?: string;
  domain?: string;
  source: ProfileSource;
  scrapeMode: ScrapeMode | null;
  scrapeLimit?: number | null;
  /** This profile's own scrape cadence, in minutes (falls back to the global default). */
  scrapeIntervalMinutes?: number | null;
  downloadImages: boolean;
  /** When true, an 'auto' profile is excluded from the recurring cron. */
  paused: boolean;
  urlPattern?: string;
  listingUrls: string[];
  fieldCount: number;
  hasImages: boolean;
  updatedAt: string | null;
  /** Most recent crawl across this profile's listing URLs (ISO), or null. */
  lastScrapedAt: string | null;
  /** Next scheduled crawl (ISO) for active auto profiles, else null. */
  nextScrapeAt: string | null;
  /** Per-profile product health (from countProductsPerProfile). */
  productCount?: number;
  scrapedCount?: number;
  syncedCount?: number;
  erroredCount?: number;
}

export interface ProfilesResponse {
  profiles: ProfileListItem[];
}

/** Partial, editable run-settings for an existing profile. */
export interface ProfileSettings {
  scrapeMode?: ScrapeMode;
  scrapeLimit?: number | null;
  scrapeIntervalMinutes?: number | null;
  downloadImages?: boolean;
  paused?: boolean;
}

export interface ProfileSettingsResponse {
  ok: boolean;
  fileName: string;
  settings: {
    scrapeMode: ScrapeMode | null;
    scrapeLimit: number | null;
    downloadImages: boolean;
    paused: boolean;
  };
}

export interface DeleteProfileResponse {
  ok: boolean;
  fileName: string;
}

// ── Sync to main GreenBidz site ──────────────────────────────────────────────

export interface SyncSubcategory {
  id: number;
  name: string;
  slug: string | null;
  parent: number;
}
export interface SyncCategory {
  id: number;
  name: string;
  slug: string | null;
  subcategories: SyncSubcategory[];
}
export interface SyncMarketplace {
  name: string;
  displayName: string;
  siteType: string;
  categories: SyncCategory[];
}
export interface SyncSeller {
  id: number;
  displayName: string;
  email?: string;
  username?: string;
  totalListings?: number;
  currency?: string;
}
export interface SyncSellersResponse {
  sellers: SyncSeller[];
  pagination: { page: number; limit: number; total: number; totalPages: number } | null;
}
export interface SyncTargetField {
  key: string;
  label: string;
  defaultSource?: string;
  enum?: string;
}
export interface SyncSourceFieldDef {
  key: string;
  label: string;
}
export interface SyncMeta {
  marketplaces: SyncMarketplace[];
  sellers: SyncSeller[];
  defaults: Record<string, unknown>;
  enums: Record<string, string[]>;
  requiredFields: string[];
  targetFields: SyncTargetField[];
  standardSourceFields: SyncSourceFieldDef[];
}
export interface SyncSourceField {
  key: string;
  label: string;
  sample: string;
}
export interface SyncSourceFieldsResponse {
  fields: SyncSourceField[];
}
export interface SyncFieldMapping {
  target_field: string;
  source_field: string;
}
export interface SyncFieldMappingsResponse {
  siteType: string;
  targetFields: SyncTargetField[];
  mappings: SyncFieldMapping[];
}
export interface SyncPreviewItem {
  productId: number;
  mapped: Record<string, unknown>;
  images: string[];
  category: {
    term_id: number;
    name: string;
    isSub: boolean;
    parent?: number | null;
    parentName?: string;
    autoMatched: boolean;
  } | null;
  categoryMatched: boolean;
  autoMatched: boolean;
  fromMapping?: boolean;
  scrapedCategory?: string | null;
  scrapedSubcategory?: string | null;
  missing: string[];
  syncable: boolean;
  error?: string;
}
export interface SyncCategoriesResponse {
  categories: SyncCategory[];
  source: 'api' | 'config';
  siteType: string;
}
export interface SyncSourceCategory {
  source_category: string;
  source_subcategory: string;
  main_term_id: number | null;
  main_term_name: string | null;
}
export interface SyncSourceCategoriesResponse {
  siteType: string;
  items: SyncSourceCategory[];
}
export interface SyncPreviewResponse {
  marketplace: string;
  siteType: string;
  seller: SyncSeller;
  country: string;
  total: number;
  syncable: number;
  blocked: number;
  results: SyncPreviewItem[];
}
export interface SyncBatchInput {
  productIds: number[];
  marketplace: string;
  sellerId: number;
  sellerName?: string;
  country: string;
  overrides?: Record<string, Record<string, unknown>>;
}
export interface SyncSubmitResponse {
  ok: boolean;
  siteType: string;
  /** Total products that succeeded (created + updated). */
  count: number;
  /** Products newly created on the main site. */
  created: number;
  /** Already-synced products updated in place (resync). */
  updated: number;
  syncedIds: number[];
  failed: { productId: number; error?: string; mode: 'create' | 'update' }[];
}

// ── Sync Management (background runs + history + scheduler) ──────────────────
export interface SyncFilters {
  profile?: string;
  priceMin?: number | '';
  priceMax?: number | '';
  titleContains?: string;
  onlyUnsynced?: boolean;
  latestOnly?: boolean;
  limit?: number;
}

export interface MappedMainCategory {
  main_term_id: number;
  main_term_name: string | null;
}
export interface MappedCategoriesResponse {
  categories: MappedMainCategory[];
}

export interface SyncCandidatesQuery {
  profile?: string;
  priceMin?: number | '';
  priceMax?: number | '';
  titleContains?: string;
  onlyUnsynced?: boolean;
  latestOnly?: boolean;
  mainCategory?: number | '';
  limit?: number | 'all';
  offset?: number;
}
export interface SyncCandidatesResponse {
  products: Product[];
  total: number;
}

export interface SyncRunPreviewResponse extends SyncPreviewResponse {
  /** Total products matching the filters (may exceed the per-run limit). */
  matched: number;
  /** The ids resolved this run (post-limit), in order. */
  resolvedIds: number[];
}

export interface SyncRunInput {
  filters: SyncFilters;
  marketplace: string;
  sellerId: number;
  sellerName?: string;
  country: string;
  overrides?: Record<string, Record<string, unknown>>;
  /** Explicit (admin-edited) id list; overrides filter resolution when present. */
  productIds?: number[];
}

export type SyncRunStatus = 'processing' | 'completed' | 'partial' | 'failed' | 'cancelled';

export interface SyncRunSummary {
  id: number;
  job_id: string | null;
  site_type: string;
  profile: string | null;
  seller_id: number;
  seller_name: string | null;
  country: string | null;
  filters_json: SyncFilters | null;
  trigger: 'manual' | 'scheduled' | 'resync';
  total: number;
  success_count: number;
  failed_count: number;
  status: SyncRunStatus;
  error_message: string | null;
  created_at: string;
  finished_at: string | null;
  duration_seconds: number | null;
}

export interface SyncItem {
  id: number;
  sync_run_id: number;
  product_id: number;
  status: 'success' | 'failed' | 'skipped';
  main_product_id: number | null;
  error: string | null;
  created_at: string;
  product_title?: string | null;
  product_url?: string | null;
}

export interface SyncRunsResponse {
  runs: SyncRunSummary[];
  total: number;
}

export interface SyncRunDetailResponse {
  run: SyncRunSummary;
  items: SyncItem[];
}

export interface ActiveSyncRun {
  id: number;
  runId: number;
  jobId: string | null;
  siteType: string;
  profile: string | null;
  total: number;
  success: number;
  failed: number;
  status: SyncRunStatus;
  startedAt: string;
}

export interface ActiveSyncRunsResponse {
  active: ActiveSyncRun[];
}

export interface StartSyncRunResponse {
  ok: boolean;
  runId: number;
  jobId: string;
  total: number;
}

// Sync scheduler — per-target intervals; the scheduler itself only pauses/resumes.
export interface SyncSchedulerTarget {
  profile?: string;
  marketplace: string;
  sellerId: number;
  sellerName?: string;
  country?: string;
  filters?: SyncFilters;
  /** This target's own interval in hours (1/2/5/10/24/120). */
  intervalHours?: number;
}
export interface SyncSchedulerConfig {
  enabled: boolean;
  targets: SyncSchedulerTarget[];
}
export interface SyncTargetRun {
  intervalHours: number;
  lastRunAt: string | null;
  nextRunAt: string | null;
}
export interface SyncSchedulerStatus {
  started: boolean;
  running: boolean;
  paused: boolean;
  busy: boolean;
  /** Base poll cron (hourly); each target fires on its own interval. */
  pollExpression: string;
  /** Earliest upcoming target run. */
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastError: string | null;
  /** A scheduler pass just kicks off runs; per-product outcomes show in History. */
  lastSummary: { runs: number; products: number } | null;
  config: SyncSchedulerConfig;
  /** Per-target runtime info, aligned by index with config.targets. */
  targetRuns: SyncTargetRun[];
}

export interface TestProductResult {
  url: string;
  ok: boolean;
  error?: string;
  title?: string | null;
  price?: number | string | null;
  priceRaw?: string | null;
  description?: string | null;
  images?: string[];
  fields?: Record<string, unknown>;
}
export interface TestProfileResponse {
  listingUrl: string;
  found: number;
  tested: number;
  results: TestProductResult[];
}

export interface RunProfileResponse {
  ok: boolean;
  runStarted: boolean;
  fileName: string;
  listingUrls: string[];
  jobId?: string | null;
}

export interface UrlPatternResponse {
  url: string;
  pattern: string;
  domain: string | null;
  match: { fileName: string; profileName?: string } | null;
}

/** One leaf urlset in a site's sitemap, summarized for the Sitemap step. */
export interface SitemapSection {
  loc: string;
  label: string;
  urlCount: number;
  sampleUrls: string[];
}

export interface SitemapSummaryResponse {
  source: string | null;
  totalUrls: number;
  sections: SitemapSection[];
}

export interface SitemapMatchResponse {
  matched: number;
  total: number;
  samples: string[];
}

export interface SaveProfileResponse {
  ok: boolean;
  fileName: string;
  overwrote: boolean;
  path: string;
  /** True when the backend kicked off an immediate one-time crawl on save. */
  runStarted?: boolean;
  /** Job id to poll /api/scrape-progress when runStarted. */
  jobId?: string | null;
}

export interface ScrapeJob {
  id: string;
  status: 'running' | 'done' | 'error' | 'cancelled';
  phase: 'starting' | 'discovering' | 'scraping' | 'done' | 'error' | 'cancelled';
  found: number;
  total: number;
  scraped: number;
  failed: number;
  current: string | null;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
  listingUrls?: string[];
}

export interface ScrapeProgressResponse {
  job: ScrapeJob;
}

/** The DOM-source mapping profile the visual builder produces & saves. */
export interface DomFieldDef {
  selector: string;
  type: 'text' | 'html' | 'attr' | 'number' | 'table' | 'keyValueTable';
  required?: boolean;
  attr?: string;
  xpath?: string;
  sampleValue?: string;
  // For 'keyValueTable': `selector` matches the repeating rows; these locate the
  // label & value within each row.
  keySelector?: string;
  valueSelector?: string;
}

export interface DomProfile {
  profileId: string;
  profileName: string;
  domain: string;
  urlPattern: string;
  source: 'dom';
  downloadImages: boolean;
  scrapeMode: ScrapeMode;
  /** Max NEW products to scrape per run (null = no cap). */
  scrapeLimit: number | null;
  /** Profile-level currency for prices (optional). */
  priceCurrency?: string;
  /** A sample product URL kept so the mapping can be re-edited in the Studio. */
  sampleProductUrl?: string;
  listingUrls: string[];
  /**
   * How product URLs are discovered. Omitted/`undefined` → crawl listing pages
   * with pagination (the original behavior). `sitemap` → read the site's XML
   * sitemap(s). `auto` → try the sitemap, fall back to listing pagination.
   */
  discovery?: {
    mode?: 'sitemap' | 'auto';
    /** Optional explicit sitemap URL (skips robots.txt + common-path probing). */
    sitemapUrl?: string;
    /** Regex a product URL must match; defaults to pagination.productUrlPattern. */
    productUrlPattern?: string;
    /** Regexes that identify category URLs — stored for future category discovery. */
    categoryPatterns?: string[];
  };
  pagination: {
    productLinkSelector?: string;
    productUrlPattern?: string;
    nextSelector?: string;
    waitForSelector?: string;
  };
  fields: Record<string, DomFieldDef>;
  selectors: {
    images?: string;
    waitForSelector?: string;
    timeout?: number;
  };
  createdAt: string;
  updatedAt: string;
  usageCount: number;
}
