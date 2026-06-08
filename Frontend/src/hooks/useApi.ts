import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { api, type ProductsQuery } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import type { ProfileSettings, SyncBatchInput } from '@/types/api';

export function useDashboardState() {
  return useQuery({
    queryKey: queryKeys.state,
    queryFn: api.getState,
  });
}

export function useProducts(q: ProductsQuery = {}) {
  return useQuery({
    queryKey: queryKeys.products(q),
    queryFn: () => api.getProducts(q),
    placeholderData: keepPreviousData,
  });
}

export function useProduct(id: number | null) {
  return useQuery({
    queryKey: queryKeys.product(id ?? -1),
    queryFn: () => api.getProduct(id as number),
    enabled: id != null,
  });
}

export function useDeleteProducts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) => api.deleteProducts(ids),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: queryKeys.state });
    },
  });
}

export function useCrawlHistory(limit = 100) {
  return useQuery({
    queryKey: queryKeys.crawlHistory(limit),
    queryFn: () => api.getCrawlHistory(limit),
  });
}

export function useActiveCrawls() {
  return useQuery({
    queryKey: queryKeys.activeCrawls,
    queryFn: api.getActiveCrawls,
    // Live progress: poll while the page is open.
    refetchInterval: 2500,
  });
}

export function useCancelScrape() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.cancelScrape(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.activeCrawls });
      qc.invalidateQueries({ queryKey: ['crawl-history'] });
    },
  });
}

export function useRunScrape() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (listingUrl: string) => api.runScrape(listingUrl),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.state });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['crawl-history'] });
      qc.invalidateQueries({ queryKey: queryKeys.activeCrawls });
    },
  });
}

export function useProfiles() {
  return useQuery({
    queryKey: queryKeys.profiles,
    queryFn: api.getProfiles,
  });
}

export function useRunProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fileName: string) => api.runProfile(fileName),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['crawl-history'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: queryKeys.state });
      qc.invalidateQueries({ queryKey: queryKeys.activeCrawls });
    },
  });
}

// ── Scheduler ───────────────────────────────────────────────────────────────

export function useScheduler() {
  return useQuery({
    queryKey: queryKeys.scheduler,
    queryFn: api.getScheduler,
    // Poll fast while a crawl is executing, slower otherwise (keeps the
    // countdown + busy indicator current without hammering the API).
    refetchInterval: (query) => (query.state.data?.busy ? 4_000 : 15_000),
  });
}

export function useSchedulerActions() {
  const qc = useQueryClient();
  const onSettled = () => {
    qc.invalidateQueries({ queryKey: queryKeys.scheduler });
    qc.invalidateQueries({ queryKey: ['crawl-history'] });
    qc.invalidateQueries({ queryKey: queryKeys.state });
  };
  const runNow = useMutation({ mutationFn: api.runSchedulerNow, onSettled });
  const pause = useMutation({ mutationFn: api.pauseScheduler, onSettled });
  const resume = useMutation({ mutationFn: api.resumeScheduler, onSettled });
  return { runNow, pause, resume };
}

export function useUpdateProfileSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { fileName: string; settings: ProfileSettings }) =>
      api.updateProfileSettings(vars.fileName, vars.settings),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.profiles });
    },
  });
}

export function useDeleteProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fileName: string) => api.deleteProfile(fileName),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.profiles });
    },
  });
}

// ── Sync to main site ─────────────────────────────────────────────────────────

export function useSyncMeta() {
  return useQuery({ queryKey: ['sync-meta'], queryFn: api.getSyncMeta, staleTime: 5 * 60 * 1000 });
}

export function useSyncCategories(marketplace: string) {
  return useQuery({
    queryKey: ['sync-categories', marketplace],
    queryFn: () => api.getSyncCategories(marketplace),
    enabled: !!marketplace,
    staleTime: 5 * 60 * 1000,
  });
}

export function useSourceCategories(
  siteType: string,
  opts: { profile?: string; productIds?: number[] },
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['source-categories', siteType, opts.profile ?? '', (opts.productIds ?? []).join(',')],
    queryFn: () => api.getSourceCategories(siteType, opts),
    enabled: enabled && !!siteType,
  });
}

export function useSaveCategoryMappings() {
  return useMutation({
    mutationFn: (body: Parameters<typeof api.saveCategoryMappings>[0]) => api.saveCategoryMappings(body),
  });
}

export function useSyncSellers(search: string) {
  return useQuery({
    queryKey: ['sync-sellers', search],
    queryFn: () => api.getSyncSellers({ search, limit: 20 }),
    placeholderData: keepPreviousData,
    staleTime: 60 * 1000,
  });
}

export function usePreviewSync() {
  return useMutation({ mutationFn: (body: SyncBatchInput) => api.previewSync(body) });
}

export function useSubmitSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SyncBatchInput) => api.submitSync(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: queryKeys.state });
    },
  });
}
