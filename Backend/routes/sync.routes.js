import { Router } from 'express';
import { asyncHandler } from '../lib/http.js';
import {
  getSyncMeta,
  getSyncSellers,
  getSyncCategories,
  getSourceCategories,
  postCategoryMappings,
  getSourceFields,
  getFieldMappings,
  postFieldMappings,
  previewSync,
  submitSync,
} from '../controllers/sync.controller.js';

const router = Router();
router.get('/sync/meta', asyncHandler(getSyncMeta));
router.get('/sync/sellers', asyncHandler(getSyncSellers));
router.get('/sync/categories', asyncHandler(getSyncCategories));
router.get('/sync/source-categories', asyncHandler(getSourceCategories));
router.post('/sync/category-mappings', asyncHandler(postCategoryMappings));
router.get('/sync/source-fields', asyncHandler(getSourceFields));
router.get('/sync/field-mappings', asyncHandler(getFieldMappings));
router.post('/sync/field-mappings', asyncHandler(postFieldMappings));
router.post('/sync/preview', asyncHandler(previewSync));
router.post('/sync/submit', asyncHandler(submitSync));
export default router;
