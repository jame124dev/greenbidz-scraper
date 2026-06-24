/**
 * @file models/product.js
 * Attributes are named in snake_case to match the existing API/JSON contract
 * (the frontend and repository expect product_url, external_id, raw_data, …).
 */
import { DataTypes } from 'sequelize';
import { sequelize } from '../config/sequelize.js';

export const Product = sequelize.define(
  'Product',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    external_id: { type: DataTypes.STRING(255), allowNull: false },
    product_url: { type: DataTypes.STRING(512), allowNull: false, unique: true },
    profile_file_name: { type: DataTypes.STRING(255), allowNull: true },
    raw_data: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
    title: { type: DataTypes.TEXT, allowNull: true },
    price: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
    description: { type: DataTypes.TEXT('medium'), allowNull: true },
    images_local_paths: { type: DataTypes.JSON, allowNull: true },
    images_remote_urls: { type: DataTypes.JSON, allowNull: true },
    first_seen_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    last_seen_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    scraped: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    scraped_at: { type: DataTypes.DATE, allowNull: true },
    scrape_attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    last_error: { type: DataTypes.TEXT, allowNull: true },
    synced_at: { type: DataTypes.DATE, allowNull: true },
    main_product_id: { type: DataTypes.INTEGER, allowNull: true },
    // Main-site batch id + the marketplace (site_type) synced to — together they
    // build the public listing link: https://<host>/buyer-marketplace/<batch>.
    main_batch_id: { type: DataTypes.INTEGER, allowNull: true },
    main_site_type: { type: DataTypes.STRING(32), allowNull: true },
    // Seller the product was synced under — reused to prefill a re-sync.
    main_seller_id: { type: DataTypes.INTEGER, allowNull: true },
    main_seller_name: { type: DataTypes.STRING(255), allowNull: true },
    // Change detection: fingerprint of current scraped content vs. last-synced.
    content_hash: { type: DataTypes.STRING(64), allowNull: true },
    synced_hash: { type: DataTypes.STRING(64), allowNull: true },
  },
  { tableName: 'products', timestamps: false },
);

export default Product;
