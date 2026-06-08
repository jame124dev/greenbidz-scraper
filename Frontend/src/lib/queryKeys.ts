import type { ProductsQuery } from './api';

export const queryKeys = {
  state: ['state'] as const,
  products: (q: ProductsQuery = {}) => ['products', q] as const,
  product: (id: number) => ['product', id] as const,
  crawlHistory: (limit: number) => ['crawl-history', limit] as const,
  activeCrawls: ['active-crawls'] as const,
  profiles: ['profiles'] as const,
  scheduler: ['scheduler'] as const,
};
