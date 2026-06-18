'use strict';

// Store the main-site batch id + the marketplace (site_type) a product was
// synced to, so we can build the public listing link
// https://<tenant host>/buyer-marketplace/<batch_id>.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('products', 'main_batch_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await queryInterface.addColumn('products', 'main_site_type', {
      type: Sequelize.STRING(32),
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('products', 'main_site_type');
    await queryInterface.removeColumn('products', 'main_batch_id');
  },
};
