/**
 * @file models/fieldMapping.js — main-site target field → scraped source field.
 * One row per (site_type, target_field). See migrations/…-create-field-mappings
 * for the source_field encoding.
 */
import { DataTypes } from 'sequelize';
import { sequelize } from '../config/sequelize.js';

export const FieldMapping = sequelize.define(
  'FieldMapping',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    site_type: { type: DataTypes.STRING(32), allowNull: false },
    target_field: { type: DataTypes.STRING(128), allowNull: false },
    source_field: { type: DataTypes.STRING(255), allowNull: false },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  },
  { tableName: 'field_mappings', timestamps: false },
);

export default FieldMapping;
