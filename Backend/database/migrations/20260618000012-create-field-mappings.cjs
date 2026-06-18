'use strict';

// Persistent routing of a main-site target field → the scraped SOURCE field it
// should be filled from, keyed by (site_type, target_field). Mapped once per
// site, then reused so sync pulls each field from the chosen source instead of
// the internal default. source_field encoding: 'title'|'description'|'price'
// (product columns), 'category'|'subcategory'|'quantity'|'condition'|'raw:<key>'
// (raw_data keys), or 'spec:<Label>' (raw_data.specifications[Label]).
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(
      'field_mappings',
      {
        id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
        site_type: { type: Sequelize.STRING(32), allowNull: false },
        // up to 128 so 'meta:<label>' bundle keys fit (see syncMapper scrape_meta).
        target_field: { type: Sequelize.STRING(128), allowNull: false },
        source_field: { type: Sequelize.STRING(255), allowNull: false },
        created_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        },
        updated_at: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        },
      },
      { charset: 'utf8mb4' },
    );
    await queryInterface.addIndex('field_mappings', ['site_type', 'target_field'], {
      unique: true,
      name: 'uq_field_mappings_key',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('field_mappings');
  },
};
