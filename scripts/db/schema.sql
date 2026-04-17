-- ============================================================
-- DramaTracker MySQL Schema
-- 执行方式：mysql -u <user> -p <database> < scripts/db/schema.sql
-- ============================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- ────────────────────────────────────────────────────────────
-- 1. drama（剧目基础数据，只保留抓取字段）
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS drama (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  playlet_id      VARCHAR(128) NOT NULL COMMENT '平台原始 ID，来自抓取',
  dedupe_key      VARCHAR(512) NOT NULL COMMENT '去重键：normalized_title|language|first_air_date',
  title           VARCHAR(512) NOT NULL,
  normalized_title VARCHAR(512) NOT NULL COMMENT '标准化标题（小写、去噪）',
  description     TEXT,
  language        VARCHAR(64),
  cover_url       TEXT,
  first_air_date  DATE,
  tags            JSON COMMENT '抓取原始标签',
  creative_count  INT UNSIGNED DEFAULT 0,
  first_seen_at   DATE,
  last_seen_at    DATE,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uk_playlet_id (playlet_id),
  UNIQUE KEY uk_dedupe_key (dedupe_key(255)),
  INDEX idx_normalized_title (normalized_title(128)),
  INDEX idx_language (language),
  INDEX idx_first_air_date (first_air_date),
  INDEX idx_updated_at (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='剧目基础数据（仅抓取字段）';


-- ────────────────────────────────────────────────────────────
-- 2. drama_review（人工审核与标签，独立于抓取数据）
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS drama_review (
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  drama_id         BIGINT UNSIGNED NOT NULL COMMENT '对应 drama.id',
  is_ai_drama      ENUM('ai_real','ai_manga','real') DEFAULT NULL COMMENT 'NULL=待审核',
  genre_tags_manual JSON COMMENT '人工标注题材标签',
  genre_tags_ai    JSON COMMENT 'AI 标注题材标签',
  genre_source     VARCHAR(64) COMMENT '标签来源：manual/ai/scraped',
  review_status    ENUM('pending','reviewed','skipped') NOT NULL DEFAULT 'pending',
  review_notes     TEXT,
  reviewed_by      VARCHAR(128),
  reviewed_at      DATETIME,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uk_drama_id (drama_id),
  INDEX idx_is_ai_drama (is_ai_drama),
  INDEX idx_review_status (review_status),
  INDEX idx_reviewed_at (reviewed_at),
  CONSTRAINT fk_review_drama FOREIGN KEY (drama_id) REFERENCES drama(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='人工审核与标签（字段级保护，不被抓取同步覆盖）';


-- ────────────────────────────────────────────────────────────
-- 3. ranking_snapshot（榜单历史快照）
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ranking_snapshot (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  drama_id     BIGINT UNSIGNED NOT NULL COMMENT '对应 drama.id',
  playlet_id   VARCHAR(128) NOT NULL COMMENT '冗余存储，方便快速查询',
  platform     VARCHAR(64)  NOT NULL,
  ranking_type VARCHAR(32)  NOT NULL DEFAULT 'heat' COMMENT 'heat/new/invest',
  date_key     DATE         NOT NULL COMMENT '快照日期',
  rank_position INT UNSIGNED NOT NULL,
  heat_value   DECIMAL(18,4) DEFAULT 0,
  heat_increment DECIMAL(18,4) DEFAULT NULL,
  material_count INT UNSIGNED DEFAULT 0,
  invest_days  INT UNSIGNED DEFAULT 0,
  raw_payload  JSON COMMENT '原始抓取 payload（可空）',
  fetched_at   DATETIME,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uk_snapshot (drama_id, platform, ranking_type, date_key),
  INDEX idx_date_key (date_key),
  INDEX idx_platform (platform),
  INDEX idx_playlet_id (playlet_id),
  INDEX idx_heat_value (heat_value),
  INDEX idx_drama_date (drama_id, date_key),
  CONSTRAINT fk_snapshot_drama FOREIGN KEY (drama_id) REFERENCES drama(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='榜单历史快照（每日每平台每剧一条）';


-- ────────────────────────────────────────────────────────────
-- 4. invest_trend（投放趋势）
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invest_trend (
  id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  drama_id            BIGINT UNSIGNED NOT NULL,
  playlet_id          VARCHAR(128) NOT NULL,
  platform            VARCHAR(64)  NOT NULL,
  date                DATE         NOT NULL,
  daily_invest_count  INT UNSIGNED DEFAULT 0,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uk_invest (drama_id, platform, date),
  INDEX idx_date (date),
  INDEX idx_playlet_id (playlet_id),
  CONSTRAINT fk_invest_drama FOREIGN KEY (drama_id) REFERENCES drama(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='每日投放趋势';


-- ────────────────────────────────────────────────────────────
-- 5. platforms（平台配置，与 SQLite 保持一致）
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS platforms (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(128) NOT NULL,
  product_ids JSON DEFAULT (JSON_ARRAY()),
  is_active   TINYINT(1) NOT NULL DEFAULT 1,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ────────────────────────────────────────────────────────────
-- 6. users（用户表）
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(128) NOT NULL,
  password      VARCHAR(255) NOT NULL,
  name          VARCHAR(128),
  role          ENUM('super_admin','operation','placement','production','screenwriter') NOT NULL,
  is_active     TINYINT(1) NOT NULL DEFAULT 1,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  last_login_at DATETIME,
  UNIQUE KEY uk_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ────────────────────────────────────────────────────────────
-- 7. drama_play_count（播放量记录）
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS drama_play_count (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  drama_id      BIGINT UNSIGNED NOT NULL,
  playlet_id    VARCHAR(128) NOT NULL,
  platform      VARCHAR(64)  NOT NULL,
  app_play_count BIGINT UNSIGNED DEFAULT 0,
  record_week   VARCHAR(16)  NOT NULL,
  record_date   DATE         NOT NULL,
  input_by      VARCHAR(128),
  note          TEXT,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_play_count (playlet_id, platform, record_week),
  CONSTRAINT fk_play_drama FOREIGN KEY (drama_id) REFERENCES drama(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ────────────────────────────────────────────────────────────
-- 8. sync_log（同步日志）
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sync_log (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  sync_type       VARCHAR(64)  NOT NULL COMMENT 'dramas/rankings/invest_trends',
  source          VARCHAR(128) COMMENT '来源标识，如 local-scraper',
  started_at      DATETIME,
  finished_at     DATETIME,
  status          ENUM('running','success','failed','partial') NOT NULL DEFAULT 'running',
  inserted_count  INT UNSIGNED DEFAULT 0,
  updated_count   INT UNSIGNED DEFAULT 0,
  skipped_count   INT UNSIGNED DEFAULT 0,
  error_message   TEXT,
  payload_summary JSON COMMENT '摘要信息',
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_sync_type (sync_type),
  INDEX idx_status (status),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='本地同步操作日志';


-- ────────────────────────────────────────────────────────────
-- 9. ai_cache（AI 分析缓存）
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_cache (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  cache_key     VARCHAR(255) NOT NULL,
  analysis_type VARCHAR(64)  NOT NULL,
  content       LONGTEXT     NOT NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at    DATETIME,
  UNIQUE KEY uk_cache_key (cache_key),
  INDEX idx_expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ────────────────────────────────────────────────────────────
-- 10. tag_system_extra（自定义标签扩展）
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tag_system_extra (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  category   VARCHAR(128) NOT NULL,
  tag_name   VARCHAR(128) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_cat_tag (category, tag_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ────────────────────────────────────────────────────────────
-- 初始数据种子
-- ────────────────────────────────────────────────────────────
INSERT IGNORE INTO platforms (name, product_ids) VALUES
  ('ShortMax',   '[365084, 365123]'),
  ('MoboShort',  '[485195, 485198]'),
  ('MoreShort',  '[393179, 445748]'),
  ('MyMuse',     '[3333645]'),
  ('LoveShots',  '[365099, 365365]'),
  ('ReelAI',     '[390514, 392263]'),
  ('HiShort',    '[413255, 413256]'),
  ('NetShort',   '[457874, 457263]'),
  ('Storeel',    '[465334, 465335]');
