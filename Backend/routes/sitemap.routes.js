import { Router } from 'express';
import { asyncHandler } from '../lib/http.js';
import { sitemapSummary, sitemapMatch } from '../controllers/sitemap.controller.js';

const router = Router();
router.get('/sitemap/summary', asyncHandler(sitemapSummary));
router.get('/sitemap/match', asyncHandler(sitemapMatch));
export default router;
