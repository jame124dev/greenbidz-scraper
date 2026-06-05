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
  scraped: boolean;
  scraped_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
  is_active: boolean;
  images_local_paths: string[];
  images_remote_urls: string[];
  last_error: string | null;
  // Present only on the single-product detail endpoint:
  description?: string | null;
  raw_data?: unknown;
  scrape_attempts?: number;
}

export interface ProductsResponse {
  counts: ProductCounts;
  products: Product[];
}

export interface CrawlRun {
  id: number;
  listing_url: string;
  products_found: number | null;
  new_products: number | null;
  failed_products: number | null;
  crawl_duration_seconds: number | null;
  status: string | null;
  error_message: string | null;
  timestamp: string;
}

export interface CrawlHistoryResponse {
  history: CrawlRun[];
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
