/**
 * @file models/index.js — central export for the Sequelize instance and all
 * models. Import models from here so the single connection is shared.
 */
import { sequelize } from '../config/sequelize.js';
import { Product } from './product.js';
import { CrawlHistory } from './crawlHistory.js';
import { PendingMapping } from './pendingMapping.js';
import { Profile } from './profile.js';
import { CategoryMapping } from './categoryMapping.js';
import { FieldMapping } from './fieldMapping.js';
import { SyncRun } from './syncRun.js';
import { SyncItem } from './syncItem.js';
import { SyncSettings } from './syncSettings.js';

// Products reference a profile loosely by profile_file_name (string). The only
// cross-table association is sync_runs → sync_items (a run's per-product rows).
SyncRun.hasMany(SyncItem, { foreignKey: 'sync_run_id', as: 'items', onDelete: 'CASCADE' });
SyncItem.belongsTo(SyncRun, { foreignKey: 'sync_run_id', as: 'run' });

export {
  sequelize,
  Product,
  CrawlHistory,
  PendingMapping,
  Profile,
  CategoryMapping,
  FieldMapping,
  SyncRun,
  SyncItem,
  SyncSettings,
};

export default {
  sequelize,
  Product,
  CrawlHistory,
  PendingMapping,
  Profile,
  CategoryMapping,
  SyncRun,
  SyncItem,
  SyncSettings,
};
