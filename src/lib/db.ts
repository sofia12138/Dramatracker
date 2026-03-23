import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'data', 'dramatracker.db');

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initDb(db);
  }
  return db;
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

    CREATE INDEX IF NOT EXISTS idx_ranking_snapshot_date ON ranking_snapshot(snapshot_date);
    CREATE INDEX IF NOT EXISTS idx_ranking_snapshot_playlet ON ranking_snapshot(playlet_id);
    CREATE INDEX IF NOT EXISTS idx_invest_trend_date ON invest_trend(date);
    CREATE INDEX IF NOT EXISTS idx_invest_trend_playlet ON invest_trend(playlet_id);
    CREATE INDEX IF NOT EXISTS idx_drama_play_count_playlet ON drama_play_count(playlet_id);
    CREATE INDEX IF NOT EXISTS idx_drama_is_ai ON drama(is_ai_drama);
  `);

  seedData(db);
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
