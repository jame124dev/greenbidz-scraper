import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type ProductsQuery } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import type { ProfileSettings } from '@/types/api';

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
  });
}

export function useProduct(id: number | null) {
  return useQuery({
    queryKey: queryKeys.product(id ?? -1),
    queryFn: () => api.getProduct(id as number),
    enabled: id != null,
  });
}

export function useCrawlHistory(limit = 100) {
  return useQuery({
    queryKey: queryKeys.crawlHistory(limit),
    queryFn: () => api.getCrawlHistory(limit),
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
    },
  });
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
