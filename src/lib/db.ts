import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';

const DB_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DB_DIR, 'dramatracker.db');

let db: Database.Database | null = null;
let _scraperLock = false;

export function getDbPath() { return DB_PATH; }
export function getDbDir() { return DB_DIR; }

export function getDb(): Database.Database {
  if (_scraperLock && !db) {
    throw new Error('DB_SCRAPER_LOCKED');
  }
  if (!db) {
    if (!fs.existsSync(DB_DIR)) {
      fs.mkdirSync(DB_DIR, { recursive: true });
    }
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 30000');
    db.pragma('foreign_keys = ON');
    initDb(db);
  }
  return db;
}

export function lockDbForScraper() {
  resetDb();
  _scraperLock = true;
  console.log('[db] locked for scraper — connections blocked');
}

export function unlockDbAfterScraper() {
  _scraperLock = false;
  console.log('[db] unlocked — connections allowed');
}

/**
 * Close current DB connection so the file can be safely replaced.
 * Next call to getDb() will re-open and re-init.
 */
export function resetDb() {
  if (db) {
    try { db.close(); } catch { /* already closed */ }
    db = null;
  }
}

/**
 * Force-close DB and prevent auto-reopen. Call via API or before process exit.
 * After calling, getDb() will still work (re-opens on demand).
 */
export function forceCloseDb(): { closed: boolean; message: string } {
  if (!db) {
    return { closed: false, message: 'No active DB connection' };
  }
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch { /* WAL may not exist */ }
  try {
    db.close();
  } catch { /* already closed */ }
  db = null;
  return { closed: true, message: 'DB connection closed and WAL flushed' };
}

let _exitHandlerRegistered = false;

export function registerExitHandler() {
  if (_exitHandlerRegistered) return;
  _exitHandlerRegistered = true;

  const cleanup = (signal: string) => {
    console.log(`[db] received ${signal}, closing database...`);
    forceCloseDb();
    process.exit(0);
  };

  process.on('SIGINT', () => cleanup('SIGINT'));
  process.on('SIGTERM', () => cleanup('SIGTERM'));
  process.on('beforeExit', () => {
    forceCloseDb();
  });
}

function initDb(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS drama (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      playlet_id TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      language TEXT,
      cover_url TEXT,
      first_air_date TEXT,
      is_ai_drama TEXT CHECK(is_ai_drama IN ('ai_real', 'ai_manga', 'real') OR is_ai_drama IS NULL),
      tags TEXT DEFAULT '[]',
      creative_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ranking_snapshot (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      playlet_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      rank INTEGER NOT NULL,
      heat_value REAL DEFAULT 0,
      material_count INTEGER DEFAULT 0,
      invest_days INTEGER DEFAULT 0,
      snapshot_date TEXT NOT NULL,
      UNIQUE(playlet_id, platform, snapshot_date)
    );

    CREATE TABLE IF NOT EXISTS invest_trend (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      playlet_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      date TEXT NOT NULL,
      daily_invest_count INTEGER DEFAULT 0,
      UNIQUE(playlet_id, platform, date)
    );

    CREATE TABLE IF NOT EXISTS platforms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      product_ids TEXT DEFAULT '[]',
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT,
      role TEXT NOT NULL CHECK(role IN ('super_admin', 'operation', 'placement', 'production', 'screenwriter')),
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      last_login_at TEXT
    );

    CREATE TABLE IF NOT EXISTS drama_play_count (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      playlet_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      app_play_count INTEGER DEFAULT 0,
      record_week TEXT NOT NULL,
      record_date TEXT NOT NULL,
      input_by TEXT,
      note TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(playlet_id, platform, record_week)
    );

    CREATE TABLE IF NOT EXISTS ai_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cache_key TEXT UNIQUE NOT NULL,
      analysis_type TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT
    );

    -- 素材预览：每个剧集预留多条素材记录，详情页当前只展示 created_at 最新的一条。
    -- 设计目的：与人审字段（is_ai_drama / genre_tags_*）完全隔离，
    -- 抓取/同步素材数据不会触碰 drama / drama_review。
    CREATE TABLE IF NOT EXISTS drama_material_asset (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drama_id INTEGER NOT NULL,
      playlet_id TEXT NOT NULL,
      platform TEXT,
      video_url TEXT,
      cover_url TEXT,
      source TEXT,
      raw_payload TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (drama_id) REFERENCES drama(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_ai_cache_key ON ai_cache(cache_key);
    CREATE INDEX IF NOT EXISTS idx_ranking_snapshot_date ON ranking_snapshot(snapshot_date);
    CREATE INDEX IF NOT EXISTS idx_ranking_snapshot_playlet ON ranking_snapshot(playlet_id);
    CREATE INDEX IF NOT EXISTS idx_invest_trend_date ON invest_trend(date);
    CREATE INDEX IF NOT EXISTS idx_invest_trend_playlet ON invest_trend(playlet_id);
    CREATE INDEX IF NOT EXISTS idx_drama_play_count_playlet ON drama_play_count(playlet_id);
    CREATE INDEX IF NOT EXISTS idx_drama_is_ai ON drama(is_ai_drama);
    CREATE INDEX IF NOT EXISTS idx_material_drama_id ON drama_material_asset(drama_id);
    CREATE INDEX IF NOT EXISTS idx_material_playlet ON drama_material_asset(playlet_id);
  `);

  migrateGenreColumns(db);
  migrateTagSystemExtra(db);
  seedData(db);
}

function migrateGenreColumns(db: Database.Database) {
  const cols = db.prepare("PRAGMA table_info(drama)").all() as { name: string }[];
  const colNames = new Set(cols.map(c => c.name));
  if (!colNames.has('genre_tags_ai')) {
    db.exec("ALTER TABLE drama ADD COLUMN genre_tags_ai TEXT DEFAULT NULL");
  }
  if (!colNames.has('genre_tags_manual')) {
    db.exec("ALTER TABLE drama ADD COLUMN genre_tags_manual TEXT DEFAULT NULL");
  }
  if (!colNames.has('genre_source')) {
    db.exec("ALTER TABLE drama ADD COLUMN genre_source TEXT DEFAULT NULL");
  }
  // Backfill: copy existing scraped tags into genre_tags_ai
  db.exec(`
    UPDATE drama SET genre_tags_ai = tags, genre_source = 'scraped'
    WHERE genre_tags_ai IS NULL AND tags IS NOT NULL AND tags != '[]' AND tags != ''
  `);
}

function migrateTagSystemExtra(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tag_system_extra (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      tag_name TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(category, tag_name)
    )
  `);
}

function seedData(db: Database.Database) {
  const platformCount = db.prepare('SELECT COUNT(*) as count FROM platforms').get() as { count: number };
  if (platformCount.count === 0) {
    const insertPlatform = db.prepare('INSERT INTO platforms (name, product_ids) VALUES (?, ?)');
    const platforms = [
      ['ShortMax', JSON.stringify([365084, 365123])],
      ['MoboShort', JSON.stringify([485195, 485198])],
      ['MoreShort', JSON.stringify([393179, 445748])],
      ['MyMuse', JSON.stringify([3333645])],
      ['LoveShots', JSON.stringify([365099, 365365])],
      ['ReelAI', JSON.stringify([390514, 392263])],
      ['HiShort', JSON.stringify([413255, 413256])],
      ['NetShort', JSON.stringify([457874, 457263])],
      ['Storeel', JSON.stringify([465334, 465335])],
    ];
    const insertMany = db.transaction((items: string[][]) => {
      for (const item of items) {
        insertPlatform.run(item[0], item[1]);
      }
    });
    insertMany(platforms);
  }

  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
  if (userCount.count === 0) {
    const hashedPassword = bcrypt.hashSync('admin123', 10);
    db.prepare('INSERT INTO users (username, password, name, role) VALUES (?, ?, ?, ?)').run('admin', hashedPassword, '超级管理员', 'super_admin');
  }
}
