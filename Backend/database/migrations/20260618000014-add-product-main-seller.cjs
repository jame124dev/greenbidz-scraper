'use strict';

// Store the main-site seller (id + name) a product was synced under, so a
// re-sync can prefill the same seller.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('products', 'main_seller_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await queryInterface.addColumn('products', 'main_seller_name', {
      type: Sequelize.STRING(255),
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('products', 'main_seller_name');
    await queryInterface.removeColumn('products', 'main_seller_id');
  },
};
