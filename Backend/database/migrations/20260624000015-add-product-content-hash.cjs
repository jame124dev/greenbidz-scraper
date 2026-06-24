'use strict';

// Change detection: store a fingerprint of the scraped content so we can tell
// when the SOURCE site changes a product after we've synced it.
//   content_hash → fingerprint of the CURRENT scraped content (set every scrape)
//   synced_hash  → fingerprint at the last successful sync to the main site
// A product needs re-syncing when it is synced (main_product_id IS NOT NULL) and
// content_hash <> synced_hash.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('products', 'content_hash', {
      type: Sequelize.STRING(64),
      allowNull: true,
    });
    await queryInterface.addColumn('products', 'synced_hash', {
      type: Sequelize.STRING(64),
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('products', 'synced_hash');
    await queryInterface.removeColumn('products', 'content_hash');
  },
};
