/**
 * Idempotent, NON-DESTRUCTIVE column add for change detection.
 *
 * Adds products.content_hash and products.synced_hash if (and only if) they are
 * missing. Safe to run against production and safe to re-run: it never drops or
 * modifies existing columns/data — it only ADDs columns that don't yet exist.
 *
 * Why not `sequelize-cli db:migrate`? This DB was created from schema.sql, so
 * SequelizeMeta is empty and db:migrate would try to re-run every migration
 * (create-products, …) against existing tables. This script sidesteps that.
 *
 * Usage:  node scripts/add-content-hash-columns.mjs
 */
import { sequelize } from '../config/sequelize.js';
import { QueryTypes } from 'sequelize';

const COLUMNS = [
  { name: 'content_hash', ddl: 'ADD COLUMN content_hash VARCHAR(64) NULL DEFAULT NULL' },
  { name: 'synced_hash', ddl: 'ADD COLUMN synced_hash VARCHAR(64) NULL DEFAULT NULL' },
];

async function existing(colNames) {
  const rows = await sequelize.query(
    `SELECT COLUMN_NAME AS name
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'products'
        AND COLUMN_NAME IN (:names)`,
    { replacements: { names: colNames }, type: QueryTypes.SELECT },
  );
  return new Set(rows.map((r) => r.name));
}

try {
  await sequelize.authenticate();
  const have = await existing(COLUMNS.map((c) => c.name));
  const missing = COLUMNS.filter((c) => !have.has(c.name));

  if (!missing.length) {
    console.log('✅ Nothing to do — content_hash and synced_hash already exist.');
  } else {
    // Single ALTER with only ADD COLUMN clauses (no drops/changes).
    const sql = `ALTER TABLE products ${missing.map((c) => c.ddl).join(', ')}`;
    console.log('Running (additive only):\n  ' + sql);
    await sequelize.query(sql);
    console.log(`✅ Added column(s): ${missing.map((c) => c.name).join(', ')}`);
  }

  // Confirm final state.
  const after = await existing(COLUMNS.map((c) => c.name));
  console.log('Verify → content_hash:', after.has('content_hash'), ' synced_hash:', after.has('synced_hash'));
} catch (err) {
  console.error('❌ Failed:', err.message);
  process.exitCode = 1;
} finally {
  await sequelize.close();
}
