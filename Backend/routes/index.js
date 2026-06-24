/**
 * @file routes/index.js — combines the per-resource routers into the /api router.
 */
import { Router } from 'express';
import stateRoutes from './state.routes.js';
import productsRoutes from './products.routes.js';
import crawlsRoutes from './crawls.routes.js';
import profilesRoutes from './profiles.routes.js';
import scrapeRoutes from './scrape.routes.js';
import sitemapRoutes from './sitemap.routes.js';
import syncRoutes from './sync.routes.js';
import syncRunsRoutes from './syncRuns.routes.js';
import syncSchedulerRoutes from './syncScheduler.routes.js';
import schedulerRoutes from './scheduler.routes.js';
import authRoutes from './auth.routes.js';

export const apiRouter = Router();

apiRouter.use(authRoutes);
apiRouter.use(stateRoutes);
apiRouter.use(productsRoutes);
apiRouter.use(crawlsRoutes);
apiRouter.use(profilesRoutes);
apiRouter.use(scrapeRoutes);
apiRouter.use(sitemapRoutes);
apiRouter.use(syncRoutes);
apiRouter.use(syncRunsRoutes);
apiRouter.use(syncSchedulerRoutes);
apiRouter.use(schedulerRoutes);

export default apiRouter;
