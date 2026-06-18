import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { api, type ProductsQuery } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import type {
  ProfileSettings,
  SyncBatchInput,
  SyncRunInput,
  SyncSchedulerConfig,
  SchedulerStatus,
  SyncSchedulerStatus,
} from '@/types/api';

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

export function useRescrape() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) => api.rescrape(ids),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: queryKeys.activeCrawls });
      qc.invalidateQueries({ queryKey: ['crawl-history'] });
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
  // Optimistically flip `paused` so the toggle feels instant; roll back on error.
  const optimistic = (paused: boolean) => ({
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: queryKeys.scheduler });
      const prev = qc.getQueryData<SchedulerStatus>(queryKeys.scheduler);
      if (prev) qc.setQueryData<SchedulerStatus>(queryKeys.scheduler, { ...prev, paused, running: !paused });
      return { prev };
    },
    onError: (_e: unknown, _v: void, ctx: { prev?: SchedulerStatus } | undefined) => {
      if (ctx?.prev) qc.setQueryData(queryKeys.scheduler, ctx.prev);
    },
    onSettled,
  });
  const runNow = useMutation({ mutationFn: api.runSchedulerNow, onSettled });
  const pause = useMutation({ mutationFn: api.pauseScheduler, ...optimistic(true) });
  const resume = useMutation({ mutationFn: api.resumeScheduler, ...optimistic(false) });
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

export function useSourceFields(
  opts: { profile?: string; productIds?: number[] },
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['source-fields', opts.profile ?? '', (opts.productIds ?? []).join(',')],
    queryFn: () => api.getSourceFields(opts),
    enabled,
  });
}

export function useFieldMappings(siteType: string, enabled: boolean) {
  return useQuery({
    queryKey: ['field-mappings', siteType],
    queryFn: () => api.getFieldMappings(siteType),
    enabled: enabled && !!siteType,
  });
}

export function useSaveFieldMappings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Parameters<typeof api.saveFieldMappings>[0]) => api.saveFieldMappings(body),
    onSuccess: (_res, body) => qc.invalidateQueries({ queryKey: ['field-mappings', body.siteType] }),
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

// ── Sync Management (background runs + history + scheduler) ──────────────────

export function useMappedCategories(profile?: string) {
  return useQuery({
    queryKey: ['mapped-categories', profile ?? ''],
    queryFn: () => api.getMappedCategories(profile),
    staleTime: 60 * 1000,
  });
}

export function useSyncCandidates(q: import('@/types/api').SyncCandidatesQuery, enabled = true) {
  return useQuery({
    queryKey: ['sync-candidates', q],
    queryFn: () => api.getSyncCandidates(q),
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useSyncRunPreview() {
  return useMutation({ mutationFn: (body: SyncRunInput) => api.previewSyncRun(body) });
}

export function useStartSyncRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SyncRunInput) => api.startSyncRun(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sync-runs'] });
      qc.invalidateQueries({ queryKey: queryKeys.activeSyncRuns });
    },
  });
}

export function useSyncRuns(filters: { profile?: string; status?: string; order?: string; limit?: number; offset?: number } = {}) {
  return useQuery({
    queryKey: queryKeys.syncRuns(filters),
    queryFn: () => api.getSyncRuns(filters),
    placeholderData: keepPreviousData,
  });
}

export function useSyncRun(id: number | null) {
  return useQuery({
    queryKey: queryKeys.syncRun(id ?? -1),
    queryFn: () => api.getSyncRun(id as number),
    enabled: id != null,
  });
}

export function useActiveSyncRuns() {
  return useQuery({
    queryKey: queryKeys.activeSyncRuns,
    queryFn: api.getActiveSyncRuns,
    refetchInterval: 2500,
  });
}

export function useResyncFailed() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (runId: number) => api.resyncFailed(runId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sync-runs'] });
      qc.invalidateQueries({ queryKey: queryKeys.activeSyncRuns });
    },
  });
}

export function useCancelSyncRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (runId: number) => api.cancelSyncRun(runId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.activeSyncRuns });
      qc.invalidateQueries({ queryKey: ['sync-runs'] });
    },
  });
}

export function useSyncScheduler() {
  return useQuery({
    queryKey: queryKeys.syncScheduler,
    queryFn: api.getSyncScheduler,
    refetchInterval: (query) => (query.state.data?.busy ? 4_000 : 20_000),
  });
}

export function useSyncSchedulerActions() {
  const qc = useQueryClient();
  const onSettled = () => {
    qc.invalidateQueries({ queryKey: queryKeys.syncScheduler });
    qc.invalidateQueries({ queryKey: ['sync-runs'] });
  };
  // Optimistically flip `paused` so the toggle feels instant; roll back on error.
  const optimistic = (paused: boolean) => ({
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: queryKeys.syncScheduler });
      const prev = qc.getQueryData<SyncSchedulerStatus>(queryKeys.syncScheduler);
      if (prev) qc.setQueryData<SyncSchedulerStatus>(queryKeys.syncScheduler, { ...prev, paused, running: !paused });
      return { prev };
    },
    onError: (_e: unknown, _v: void, ctx: { prev?: SyncSchedulerStatus } | undefined) => {
      if (ctx?.prev) qc.setQueryData(queryKeys.syncScheduler, ctx.prev);
    },
    onSettled,
  });
  const runNow = useMutation({ mutationFn: api.runSyncSchedulerNow, onSettled });
  const pause = useMutation({ mutationFn: api.pauseSyncScheduler, ...optimistic(true) });
  const resume = useMutation({ mutationFn: api.resumeSyncScheduler, ...optimistic(false) });
  const saveConfig = useMutation({ mutationFn: (c: SyncSchedulerConfig) => api.saveSyncSchedulerConfig(c), onSettled });
  return { runNow, pause, resume, saveConfig };
}
