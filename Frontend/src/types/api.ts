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
  listingUrlCount: number;
  scrapeLimit: number | null;
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
  intervalHours: number;
  expression: string;
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
}

export interface ProfilesResponse {
  profiles: ProfileListItem[];
}

/** Partial, editable run-settings for an existing profile. */
export interface ProfileSettings {
  scrapeMode?: ScrapeMode;
  scrapeLimit?: number | null;
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
export interface SyncMeta {
  marketplaces: SyncMarketplace[];
  sellers: SyncSeller[];
  defaults: Record<string, unknown>;
  enums: Record<string, string[]>;
  requiredFields: string[];
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
  count: number;
  mainApiResponse: unknown;
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
  type: 'text' | 'html' | 'attr' | 'number';
  required?: boolean;
  attr?: string;
  xpath?: string;
  sampleValue?: string;
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
  listingUrls: string[];
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
