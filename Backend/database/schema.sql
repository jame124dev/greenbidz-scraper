-- ============================================================================
-- Product Monitor — MySQL schema
-- ----------------------------------------------------------------------------
-- This is the FULL schema and is kept in sync with the Sequelize migrations in
-- database/migrations/. setup.js runs this file (via `npm run setup`) to create
-- every table the app needs in one shot, so a fresh/empty database is ready to
-- use without running the migrations separately.
--
-- Conventions (ported from the original PostgreSQL spec to MySQL 5.7+/MariaDB):
--   * SERIAL            -> INT AUTO_INCREMENT PRIMARY KEY
--   * JSON / JSONB      -> LONGTEXT holding JSON. Portable across MySQL 5.7/8
--                          and MariaDB 10.1+, and proven compatible with the
--                          Sequelize models here (which declare DataTypes.JSON
--                          and parse the text on read — see models/*.js).
--   * TEXT[] arrays     -> LONGTEXT holding a JSON array of strings
--   * NOW()             -> CURRENT_TIMESTAMP
--   * DECIMAL(10,2)     -> unchanged
--
-- The database itself (DB_DATABASE) is assumed to exist. CREATE TABLE IF NOT
-- EXISTS makes re-running this file idempotent (it will NOT alter columns on a
-- table that already exists — drop the table first if the shape changed).
-- ============================================================================

-- ── Products ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
    id                  INT AUTO_INCREMENT PRIMARY KEY,
    external_id         VARCHAR(255) NOT NULL,
    -- 512 chars: labassets (and similar) product URLs include long descriptive
    -- slugs. 512 * 4 bytes (utf8mb4) = 2048 bytes, within InnoDB's 3072-byte
    -- unique-index limit (innodb_large_prefix / DYNAMIC row format).
    product_url         VARCHAR(512) NOT NULL,
    profile_file_name   VARCHAR(255),
    raw_data            LONGTEXT NOT NULL,
    title               TEXT,
    price               DECIMAL(10, 2),
    description         MEDIUMTEXT,
    images_local_paths  LONGTEXT,       -- JSON array of strings
    images_remote_urls  LONGTEXT,       -- JSON array of strings
    first_seen_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    -- Discovery flag: a product is first inserted as a stub with scraped = FALSE
    -- (it was found in a listing) and flipped to TRUE once fully scraped. This
    -- replaces the old separate seen_products table.
    scraped             BOOLEAN NOT NULL DEFAULT FALSE,
    scraped_at          TIMESTAMP NULL DEFAULT NULL,
    scrape_attempts     INT NOT NULL DEFAULT 0,
    last_error          TEXT,
    -- Sync-to-main-site tracking.
    synced_at           TIMESTAMP NULL DEFAULT NULL,
    main_product_id     INT NULL DEFAULT NULL,
    main_batch_id       INT NULL DEFAULT NULL,
    main_site_type      VARCHAR(32) NULL DEFAULT NULL,
    main_seller_id      INT NULL DEFAULT NULL,
    main_seller_name    VARCHAR(255) NULL DEFAULT NULL,
    -- Change detection: fingerprint of current scraped content vs. the one at
    -- last sync. Differing values (when synced) ⇒ the source changed.
    content_hash        VARCHAR(64) NULL DEFAULT NULL,
    synced_hash         VARCHAR(64) NULL DEFAULT NULL,
    UNIQUE KEY uq_products_url (product_url),
    KEY idx_products_profile (profile_file_name),
    KEY idx_products_first_seen (first_seen_at),
    KEY idx_products_active (is_active),
    KEY idx_products_scraped (scraped)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- NOTE: There is no separate seen_products table. The discovery queue and the
-- duplicate-prevention flag live directly on products (the `scraped` column).
-- The ONLY_NEW_PRODUCTS flag (see config/constants.js) decides whether a crawl
-- cycle scrapes only the scraped = FALSE rows (true) or every product (false).

-- ── Crawl history ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crawl_history (
    id                      INT AUTO_INCREMENT PRIMARY KEY,
    listing_url             TEXT NOT NULL,
    products_found          INT,
    new_products            INT,
    failed_products         INT,
    scraped_products        INT,
    crawl_duration_seconds  INT,
    status                  VARCHAR(50),
    error_message           TEXT,
    timestamp               TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_crawl_history_ts (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Pending mappings (for review) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pending_mappings (
    id                    INT AUTO_INCREMENT PRIMARY KEY,
    url_pattern           VARCHAR(191) NOT NULL,
    sample_url            TEXT NOT NULL,
    auto_detected_fields  LONGTEXT,
    user_approved_fields  LONGTEXT,
    status                VARCHAR(50) NOT NULL DEFAULT 'pending', -- pending/approved/rejected
    created_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_at           TIMESTAMP NULL DEFAULT NULL,
    UNIQUE KEY uq_pending_pattern (url_pattern)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Profiles (DB-backed mapping profiles + per-profile settings) ─────────────
CREATE TABLE IF NOT EXISTS profiles (
    id                INT AUTO_INCREMENT PRIMARY KEY,
    file_name         VARCHAR(255) NOT NULL,
    profile_id        VARCHAR(255),
    profile_name      VARCHAR(255),
    domain            VARCHAR(191),
    source            VARCHAR(16) NOT NULL DEFAULT 'dom',
    scrape_mode       VARCHAR(16),
    scrape_limit      INT,
    download_images   BOOLEAN NOT NULL DEFAULT TRUE,
    paused            BOOLEAN NOT NULL DEFAULT FALSE,
    url_pattern       TEXT,
    config            LONGTEXT NOT NULL,   -- JSON
    created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_profiles_file_name (file_name),
    KEY idx_profiles_domain (domain),
    KEY idx_profiles_scrape_mode (scrape_mode)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Category mappings (source category → main-site category) ─────────────────
CREATE TABLE IF NOT EXISTS category_mappings (
    id                  INT AUTO_INCREMENT PRIMARY KEY,
    site_type           VARCHAR(32) NOT NULL,
    source_category     VARCHAR(255) NOT NULL,
    -- '' (not NULL) so the unique key treats "no subcategory" consistently.
    source_subcategory  VARCHAR(255) NOT NULL DEFAULT '',
    main_term_id        INT NOT NULL,
    main_term_name      VARCHAR(255),
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_category_mappings_key (site_type, source_category, source_subcategory)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Sync runs (one bulk submission to the main site) ─────────────────────────
CREATE TABLE IF NOT EXISTS sync_runs (
    id                INT AUTO_INCREMENT PRIMARY KEY,
    job_id            VARCHAR(64),
    site_type         VARCHAR(32) NOT NULL,
    profile           VARCHAR(255),
    seller_id         INT NOT NULL,
    seller_name       VARCHAR(255),
    country           VARCHAR(128),
    filters_json      LONGTEXT,            -- JSON
    -- `trigger` is a reserved word in MySQL — must stay backticked everywhere.
    `trigger`         VARCHAR(16) NOT NULL DEFAULT 'manual',
    total             INT NOT NULL DEFAULT 0,
    success_count     INT NOT NULL DEFAULT 0,
    failed_count      INT NOT NULL DEFAULT 0,
    status            VARCHAR(16) NOT NULL DEFAULT 'processing',
    error_message     TEXT,
    created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at       TIMESTAMP NULL DEFAULT NULL,
    duration_seconds  INT,
    KEY idx_sync_runs_created (created_at),
    KEY idx_sync_runs_status (status),
    KEY idx_sync_runs_profile (profile)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Sync items (per-product outcome of a sync run) ───────────────────────────
CREATE TABLE IF NOT EXISTS sync_items (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    sync_run_id      INT NOT NULL,
    product_id       INT NOT NULL,
    status           VARCHAR(16) NOT NULL,  -- success / failed / skipped
    main_product_id  INT,
    error            TEXT,
    created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_sync_items_run (sync_run_id),
    KEY idx_sync_items_product (product_id),
    KEY idx_sync_items_run_status (sync_run_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Sync settings (single-row durable config for the sync scheduler) ─────────
CREATE TABLE IF NOT EXISTS sync_settings (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    config_json  LONGTEXT,                 -- JSON
    updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Field mappings (main-site target field → scraped source field) ───────────
-- source_field: 'title'|'description'|'price' (product columns),
-- 'category'|'subcategory'|'quantity'|'condition'|'raw:<key>' (raw_data keys),
-- or 'spec:<Label>' (raw_data.specifications[Label]). Reused on every sync.
CREATE TABLE IF NOT EXISTS field_mappings (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    site_type     VARCHAR(32)  NOT NULL,
    target_field  VARCHAR(128) NOT NULL,   -- 'meta:<label>' bundle keys fit here
    source_field  VARCHAR(255) NOT NULL,
    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_field_mappings_key (site_type, target_field)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- All performance indexes are declared inline within the CREATE TABLE
-- statements above (MySQL has no "CREATE INDEX IF NOT EXISTS"), so re-running
-- this file is idempotent.
