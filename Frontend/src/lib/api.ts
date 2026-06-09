// Thin fetch wrapper + typed endpoint functions. All requests go directly to
// the backend API at API_BASE (default http://localhost:4000), no Vite proxy.
// Override with VITE_API_BASE_URL in the Frontend env.

import type {
  ActiveCrawlsResponse,
  CrawlHistoryResponse,
  DeleteProfileResponse,
  DomProfile,
  Product,
  ProductsResponse,
  ProfileSettings,
  ProfileSettingsResponse,
  ProfilesResponse,
  RunProfileResponse,
  SaveProfileResponse,
  TestProfileResponse,
  SchedulerStatus,
  ScrapeProgressResponse,
  StateResponse,
  SyncBatchInput,
  SyncCategoriesResponse,
  SyncMeta,
  SyncPreviewResponse,
  SyncSellersResponse,
  SyncSourceCategoriesResponse,
  SyncSubmitResponse,
  SyncRunInput,
  MappedCategoriesResponse,
  SyncCandidatesQuery,
  SyncCandidatesResponse,
  SyncRunPreviewResponse,
  StartSyncRunResponse,
  SyncRunsResponse,
  SyncRunDetailResponse,
  ActiveSyncRunsResponse,
  SyncSchedulerStatus,
  SyncSchedulerConfig,
  UrlPatternResponse,
} from '@/types/api';

// Backend API origin. Empty string would fall back to same-origin; we default
// to the local backend port so the frontend talks to it directly.
export const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000').replace(/\/$/, '');

export class ApiError extends Error {
  status: number;
  details?: unknown;
  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    });
  } catch (err) {
    throw new ApiError(
      `Network error — is the backend running on :4000? (${(err as Error).message})`,
      0,
    );
  }

  const text = await res.text();
  const body = text ? safeParse(text) : null;

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    if (body && typeof body === 'object' && 'error' in body) {
      message = String((body as { error: unknown }).error);
    }
    throw new ApiError(message, res.status, body);
  }
  return body as T;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export interface ProductsQuery {
  limit?: number;
  offset?: number;
  scrapedOnly?: boolean;
  status?: 'all' | 'scraped' | 'unscraped' | 'incomplete';
  profile?: string;
  search?: string;
}

export const api = {
  getState: () => request<StateResponse>('/state'),

  getProducts: (q: ProductsQuery = {}) => {
    const params = new URLSearchParams();
    if (q.limit) params.set('limit', String(q.limit));
    if (q.offset) params.set('offset', String(q.offset));
    if (q.scrapedOnly) params.set('scrapedOnly', 'true');
    if (q.status && q.status !== 'all') params.set('status', q.status);
    if (q.profile) params.set('profile', q.profile);
    if (q.search) params.set('search', q.search);
    const qs = params.toString();
    return request<ProductsResponse>(`/products${qs ? `?${qs}` : ''}`);
  },

  getProduct: (id: number) => request<{ product: Product }>(`/products/${id}`),

  deleteProducts: (ids: number[]) =>
    request<{ ok: boolean; deleted: number }>('/products/delete', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),

  rescrape: (ids: number[]) =>
    request<{ ok: boolean; jobId: string; count: number }>('/rescrape', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),

  getCrawlHistory: (limit = 100) =>
    request<CrawlHistoryResponse>(`/crawl-history?limit=${limit}`),

  getActiveCrawls: () => request<ActiveCrawlsResponse>('/active-crawls'),

  runScrape: (listingUrl: string) =>
    request<{ ok: boolean; summary: unknown; counts: unknown }>('/scrape', {
      method: 'POST',
      body: JSON.stringify({ listingUrl }),
    }),

  // ── Mapping Studio (Phase 2) ────────────────────────────────────────────────

  /**
   * Same-origin snapshot URL for the Studio iframe. This stays RELATIVE (no
   * API_BASE) so it goes through the Vite dev proxy and the iframe is same-origin
   * with the app — required for testSelector/countMatches to read contentDocument.
   */
  proxyPageSrc: (url: string) => `/api/proxy-page?url=${encodeURIComponent(url)}`,

  getUrlPattern: (url: string) =>
    request<UrlPatternResponse>('/url-pattern', {
      method: 'POST',
      body: JSON.stringify({ url }),
    }),

  saveProfile: (fileName: string | null, profile: DomProfile, runNow = true) =>
    request<SaveProfileResponse>('/save-profile', {
      method: 'POST',
      body: JSON.stringify({ fileName, profile, runNow }),
    }),

  getProfiles: () => request<ProfilesResponse>('/profiles'),

  getProfileConfig: (fileName: string) =>
    request<{ fileName: string; config: DomProfile }>(`/profile?fileName=${encodeURIComponent(fileName)}`),

  testProfile: (profile: DomProfile, limit = 3) =>
    request<TestProfileResponse>('/test-profile', {
      method: 'POST',
      body: JSON.stringify({ profile, limit }),
    }),

  runProfile: (fileName: string) =>
    request<RunProfileResponse>('/run-profile', {
      method: 'POST',
      body: JSON.stringify({ fileName }),
    }),

  updateProfileSettings: (fileName: string, settings: ProfileSettings) =>
    request<ProfileSettingsResponse>('/profile-settings', {
      method: 'POST',
      body: JSON.stringify({ fileName, settings }),
    }),

  deleteProfile: (fileName: string) =>
    request<DeleteProfileResponse>('/delete-profile', {
      method: 'POST',
      body: JSON.stringify({ fileName }),
    }),

  // ── Sync to main site ───────────────────────────────────────────────────────
  getSyncMeta: () => request<SyncMeta>('/sync/meta'),

  getSyncCategories: (siteType: string, language = 'en') =>
    request<SyncCategoriesResponse>(
      `/sync/categories?siteType=${encodeURIComponent(siteType)}&language=${language}`,
    ),

  getSourceCategories: (siteType: string, opts: { profile?: string; productIds?: number[] } = {}) => {
    const params = new URLSearchParams();
    params.set('siteType', siteType);
    if (opts.profile) params.set('profile', opts.profile);
    if (opts.productIds?.length) params.set('productIds', opts.productIds.join(','));
    return request<SyncSourceCategoriesResponse>(`/sync/source-categories?${params.toString()}`);
  },

  saveCategoryMappings: (body: {
    siteType: string;
    mappings: Array<{
      source_category: string;
      source_subcategory: string;
      main_term_id: number;
      main_term_name: string;
    }>;
  }) =>
    request<{ ok: boolean; written: number }>('/sync/category-mappings', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getSyncSellers: (q: { search?: string; page?: number; limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (q.search) params.set('search', q.search);
    if (q.page) params.set('page', String(q.page));
    params.set('limit', String(q.limit ?? 20));
    return request<SyncSellersResponse>(`/sync/sellers?${params.toString()}`);
  },

  previewSync: (body: SyncBatchInput) =>
    request<SyncPreviewResponse>('/sync/preview', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  submitSync: (body: SyncBatchInput) =>
    request<SyncSubmitResponse>('/sync/submit', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // ── Sync Management (background runs + history + scheduler) ────────────────
  getMappedCategories: (profile?: string) =>
    request<MappedCategoriesResponse>(`/sync/mapped-categories${profile ? `?profile=${encodeURIComponent(profile)}` : ''}`),

  getSyncCandidates: (q: SyncCandidatesQuery = {}) => {
    const params = new URLSearchParams();
    if (q.profile) params.set('profile', q.profile);
    if (q.priceMin !== undefined && q.priceMin !== '') params.set('priceMin', String(q.priceMin));
    if (q.priceMax !== undefined && q.priceMax !== '') params.set('priceMax', String(q.priceMax));
    if (q.titleContains) params.set('titleContains', q.titleContains);
    if (q.onlyUnsynced === false) params.set('onlyUnsynced', 'false');
    if (q.latestOnly) params.set('latestOnly', 'true');
    if (q.mainCategory !== undefined && q.mainCategory !== '') params.set('mainCategory', String(q.mainCategory));
    params.set('limit', q.limit == null ? 'all' : String(q.limit));
    params.set('offset', String(q.offset ?? 0));
    return request<SyncCandidatesResponse>(`/sync/candidates?${params.toString()}`);
  },

  getSyncCandidateIds: (q: SyncCandidatesQuery = {}) => {
    const params = new URLSearchParams();
    if (q.profile) params.set('profile', q.profile);
    if (q.priceMin !== undefined && q.priceMin !== '') params.set('priceMin', String(q.priceMin));
    if (q.priceMax !== undefined && q.priceMax !== '') params.set('priceMax', String(q.priceMax));
    if (q.titleContains) params.set('titleContains', q.titleContains);
    if (q.onlyUnsynced === false) params.set('onlyUnsynced', 'false');
    if (q.latestOnly) params.set('latestOnly', 'true');
    if (q.mainCategory !== undefined && q.mainCategory !== '') params.set('mainCategory', String(q.mainCategory));
    params.set('limit', q.limit == null ? 'all' : String(q.limit));
    return request<{ ids: number[]; total: number }>(`/sync/candidate-ids?${params.toString()}`);
  },

  previewSyncRun: (body: SyncRunInput) =>
    request<SyncRunPreviewResponse>('/sync/run/preview', { method: 'POST', body: JSON.stringify(body) }),

  startSyncRun: (body: SyncRunInput) =>
    request<StartSyncRunResponse>('/sync/run', { method: 'POST', body: JSON.stringify(body) }),

  getSyncRuns: (q: { profile?: string; status?: string; order?: string; limit?: number; offset?: number } = {}) => {
    const params = new URLSearchParams();
    if (q.profile) params.set('profile', q.profile);
    if (q.status && q.status !== 'all') params.set('status', q.status);
    if (q.order) params.set('order', q.order);
    params.set('limit', String(q.limit ?? 50));
    params.set('offset', String(q.offset ?? 0));
    return request<SyncRunsResponse>(`/sync/runs?${params.toString()}`);
  },

  getSyncRun: (id: number) => request<SyncRunDetailResponse>(`/sync/runs/${id}`),

  getActiveSyncRuns: () => request<ActiveSyncRunsResponse>('/sync/active'),

  resyncFailed: (runId: number) =>
    request<StartSyncRunResponse>(`/sync/runs/${runId}/resync-failed`, { method: 'POST' }),

  cancelSyncRun: (runId: number) =>
    request<{ ok: boolean }>(`/sync/runs/${runId}/cancel`, { method: 'POST' }),

  // Sync scheduler
  getSyncScheduler: () => request<SyncSchedulerStatus>('/sync/scheduler'),
  runSyncSchedulerNow: () => request<SyncSchedulerStatus>('/sync/scheduler/run', { method: 'POST' }),
  pauseSyncScheduler: () => request<SyncSchedulerStatus>('/sync/scheduler/pause', { method: 'POST' }),
  resumeSyncScheduler: () => request<SyncSchedulerStatus>('/sync/scheduler/resume', { method: 'POST' }),
  saveSyncSchedulerConfig: (config: SyncSchedulerConfig) =>
    request<SyncSchedulerStatus>('/sync/scheduler/config', { method: 'POST', body: JSON.stringify(config) }),

  // ── Scheduler ───────────────────────────────────────────────────────────────
  getScheduler: () => request<SchedulerStatus>('/scheduler'),

  runSchedulerNow: () => request<SchedulerStatus>('/scheduler/run', { method: 'POST' }),

  pauseScheduler: () => request<SchedulerStatus>('/scheduler/pause', { method: 'POST' }),

  resumeScheduler: () => request<SchedulerStatus>('/scheduler/resume', { method: 'POST' }),

  getScrapeProgress: (id: string) =>
    request<ScrapeProgressResponse>(`/scrape-progress?id=${encodeURIComponent(id)}`),

  cancelScrape: (id: string) =>
    request<{ ok: boolean }>('/scrape-cancel', {
      method: 'POST',
      body: JSON.stringify({ id }),
    }),
};
