import { Router } from 'express';
import { asyncHandler } from '../lib/http.js';
import { getCrawlHistory, getActiveCrawls } from '../controllers/crawls.controller.js';

const router = Router();
router.get('/crawl-history', asyncHandler(getCrawlHistory));
router.get('/active-crawls', asyncHandler(getActiveCrawls));
export default router;
