/**
 * 安全导入验证脚本 — 完整闭环测试
 * 用法: node scripts/verify-safe-import.js
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const TEST_DIR = path.join(__dirname, '..', 'data', 'tmp');
const SRC_PATH = path.join(TEST_DIR, 'test_source.db');
const TGT_PATH = path.join(TEST_DIR, 'test_target.db');

if (!fs.existsSync(TEST_DIR)) fs.mkdirSync(TEST_DIR, { recursive: true });
for (const f of [SRC_PATH, TGT_PATH]) if (fs.existsSync(f)) fs.unlinkSync(f);

const SCRAPER_FIELDS = ['title', 'description', 'language', 'cover_url', 'first_air_date', 'tags', 'creative_count'];
const REVIEW_FIELDS = ['is_ai_drama', 'genre_tags_manual', 'genre_tags_ai', 'genre_source'];

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) { console.log(`  ✅ ${label}`); passed++; }
  else { console.log(`  ❌ FAIL: ${label}`); failed++; }
}

// ── Setup: create source DB (simulates local scraper DB) ──
const src = new Database(SRC_PATH);
src.exec(`
  CREATE TABLE drama (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    playlet_id TEXT UNIQUE NOT NULL,
    title TEXT, description TEXT, language TEXT, cover_url TEXT,
    first_air_date TEXT, is_ai_drama TEXT, tags TEXT DEFAULT '[]',
    creative_count INTEGER DEFAULT 0
  );
  CREATE TABLE ranking_snapshot (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    playlet_id TEXT NOT NULL, platform TEXT NOT NULL, rank INTEGER NOT NULL,
    heat_value REAL DEFAULT 0, material_count INTEGER DEFAULT 0,
    invest_days INTEGER DEFAULT 0, snapshot_date TEXT NOT NULL,
    UNIQUE(playlet_id, platform, snapshot_date)
  );
`);

// Source has 3 dramas: one already exists in target (reviewed), one exists (unreviewed), one is new
src.prepare(`INSERT INTO drama (playlet_id, title, description, language, tags, creative_count)
  VALUES (?, ?, ?, ?, ?, ?)`).run('PID_REVIEWED', 'New Title From Scraper', 'New Desc', 'en', '["action"]', 99);
src.prepare(`INSERT INTO drama (playlet_id, title, description, language, tags, creative_count)
  VALUES (?, ?, ?, ?, ?, ?)`).run('PID_UNREVIEWED', 'Updated Unreviewed', 'Updated Desc', 'zh', '["romance"]', 50);
src.prepare(`INSERT INTO drama (playlet_id, title, description, language, tags, creative_count)
  VALUES (?, ?, ?, ?, ?, ?)`).run('PID_BRAND_NEW', 'Brand New Drama', 'A new drama', 'en', '["comedy"]', 10);

// Source has ranking snapshots (some will be duplicates)
src.prepare(`INSERT INTO ranking_snapshot (playlet_id, platform, rank, heat_value, snapshot_date) VALUES (?,?,?,?,?)`)
  .run('PID_REVIEWED', 'ShortMax', 1, 9999, '2026-03-28');
src.prepare(`INSERT INTO ranking_snapshot (playlet_id, platform, rank, heat_value, snapshot_date) VALUES (?,?,?,?,?)`)
  .run('PID_REVIEWED', 'ShortMax', 2, 8888, '2026-03-27'); // this one will be a duplicate
src.prepare(`INSERT INTO ranking_snapshot (playlet_id, platform, rank, heat_value, snapshot_date) VALUES (?,?,?,?,?)`)
  .run('PID_BRAND_NEW', 'MoboShort', 5, 5555, '2026-03-28');

src.close();

// ── Setup: create target DB (simulates online DB with review data) ──
const tgt = new Database(TGT_PATH);
tgt.exec(`
  CREATE TABLE drama (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    playlet_id TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL, description TEXT, language TEXT, cover_url TEXT,
    first_air_date TEXT,
    is_ai_drama TEXT CHECK(is_ai_drama IN ('ai_real','ai_manga','real') OR is_ai_drama IS NULL),
    tags TEXT DEFAULT '[]', creative_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
    genre_tags_ai TEXT, genre_tags_manual TEXT, genre_source TEXT
  );
  CREATE TABLE ranking_snapshot (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    playlet_id TEXT NOT NULL, platform TEXT NOT NULL, rank INTEGER NOT NULL,
    heat_value REAL DEFAULT 0, material_count INTEGER DEFAULT 0,
    invest_days INTEGER DEFAULT 0, snapshot_date TEXT NOT NULL,
    UNIQUE(playlet_id, platform, snapshot_date)
  );
`);

// Target already has PID_REVIEWED — fully reviewed
tgt.prepare(`INSERT INTO drama (playlet_id, title, description, language, tags, creative_count,
  is_ai_drama, genre_tags_manual, genre_tags_ai, genre_source)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  .run('PID_REVIEWED', 'Old Title', 'Old Desc', 'zh', '["old"]', 1,
    'ai_real', '["情感","复仇"]', '["情感"]', 'manual');

// Target already has PID_UNREVIEWED — not yet reviewed
tgt.prepare(`INSERT INTO drama (playlet_id, title, description, language, tags, creative_count)
  VALUES (?, ?, ?, ?, ?, ?)`)
  .run('PID_UNREVIEWED', 'Old Unreviewed Title', 'Old Desc', 'en', '["old"]', 5);

// Target already has one ranking snapshot that will be a duplicate
tgt.prepare(`INSERT INTO ranking_snapshot (playlet_id, platform, rank, heat_value, snapshot_date) VALUES (?,?,?,?,?)`)
  .run('PID_REVIEWED', 'ShortMax', 2, 8888, '2026-03-27');

// ── Record "before" state ──
const beforeReviewed = tgt.prepare('SELECT * FROM drama WHERE playlet_id = ?').get('PID_REVIEWED');
const beforeSnapshotCount = (tgt.prepare('SELECT COUNT(*) as c FROM ranking_snapshot').get()).c;

// ═══════════════════════════════════════════
//  Execute the SAME merge logic as the API
// ═══════════════════════════════════════════
const srcDb = new Database(SRC_PATH, { readonly: true });

const srcDramas = srcDb.prepare(
  'SELECT playlet_id, title, description, language, cover_url, first_air_date, tags, creative_count FROM drama'
).all();

const updateSet = SCRAPER_FIELDS.map(f => `${f} = ?`).join(', ');
const updateStmt = tgt.prepare(`UPDATE drama SET ${updateSet}, updated_at = datetime('now') WHERE playlet_id = ?`);
const insertStmt = tgt.prepare(
  `INSERT INTO drama (playlet_id, title, description, language, cover_url, first_air_date, is_ai_drama, tags, creative_count) VALUES (?,?,?,?,?,?,NULL,?,?)`
);
const existsStmt = tgt.prepare('SELECT id FROM drama WHERE playlet_id = ?');

const stats = { drama_new: 0, drama_updated: 0, ranking_inserted: 0 };

const mergeDramas = tgt.transaction((rows) => {
  for (const row of rows) {
    const existing = existsStmt.get(row.playlet_id);
    if (existing) {
      updateStmt.run(...SCRAPER_FIELDS.map(f => row[f] ?? null), row.playlet_id);
      stats.drama_updated++;
    } else {
      insertStmt.run(row.playlet_id, row.title ?? '', row.description ?? null, row.language ?? null,
        row.cover_url ?? null, row.first_air_date ?? null, row.tags ?? '[]', row.creative_count ?? 0);
      stats.drama_new++;
    }
  }
});
mergeDramas(srcDramas);

const srcSnapshots = srcDb.prepare(
  'SELECT playlet_id, platform, rank, heat_value, material_count, invest_days, snapshot_date FROM ranking_snapshot'
).all();

const insertSnapshot = tgt.prepare(
  `INSERT OR IGNORE INTO ranking_snapshot (playlet_id, platform, rank, heat_value, material_count, invest_days, snapshot_date) VALUES (?,?,?,?,?,?,?)`
);
const mergeSnapshots = tgt.transaction((rows) => {
  for (const row of rows) {
    const r = insertSnapshot.run(row.playlet_id, row.platform, row.rank, row.heat_value ?? 0,
      row.material_count ?? 0, row.invest_days ?? 0, row.snapshot_date);
    if (r.changes > 0) stats.ranking_inserted++;
  }
});
mergeSnapshots(srcSnapshots);

srcDb.close();

// ═══════════════════════════════════════════
//  Verify Results
// ═══════════════════════════════════════════

console.log('\n══════════════════════════════════════');
console.log(' 场景一：已审核剧保护验证 (PID_REVIEWED)');
console.log('══════════════════════════════════════');

const afterReviewed = tgt.prepare('SELECT * FROM drama WHERE playlet_id = ?').get('PID_REVIEWED');

assert(afterReviewed.is_ai_drama === 'ai_real', `is_ai_drama 保留 = "${afterReviewed.is_ai_drama}" (期望 "ai_real")`);
assert(afterReviewed.genre_tags_manual === '["情感","复仇"]', `genre_tags_manual 保留 = ${afterReviewed.genre_tags_manual}`);
assert(afterReviewed.genre_tags_ai === '["情感"]', `genre_tags_ai 保留 = ${afterReviewed.genre_tags_ai}`);
assert(afterReviewed.genre_source === 'manual', `genre_source 保留 = "${afterReviewed.genre_source}"`);
assert(afterReviewed.title === 'New Title From Scraper', `title 已更新 = "${afterReviewed.title}" (旧值 "Old Title")`);
assert(afterReviewed.description === 'New Desc', `description 已更新 = "${afterReviewed.description}"`);
assert(afterReviewed.language === 'en', `language 已更新 = "${afterReviewed.language}" (旧值 "zh")`);
assert(afterReviewed.tags === '["action"]', `tags 已更新 = ${afterReviewed.tags} (旧值 ["old"])`);
assert(afterReviewed.creative_count === 99, `creative_count 已更新 = ${afterReviewed.creative_count} (旧值 1)`);

console.log('\n══════════════════════════════════════');
console.log(' 场景二：新剧插入验证 (PID_BRAND_NEW)');
console.log('══════════════════════════════════════');

const newDrama = tgt.prepare('SELECT * FROM drama WHERE playlet_id = ?').get('PID_BRAND_NEW');

assert(newDrama !== undefined, '新剧已插入');
assert(newDrama.title === 'Brand New Drama', `title = "${newDrama.title}"`);
assert(newDrama.is_ai_drama === null, `is_ai_drama = null (待审核) — 实际: ${newDrama.is_ai_drama}`);
assert(newDrama.genre_tags_manual === null, `genre_tags_manual = null — 实际: ${newDrama.genre_tags_manual}`);
assert(newDrama.genre_tags_ai === null, `genre_tags_ai = null — 实际: ${newDrama.genre_tags_ai}`);
assert(newDrama.genre_source === null, `genre_source = null — 实际: ${newDrama.genre_source}`);
assert(newDrama.creative_count === 10, `creative_count = 10 — 实际: ${newDrama.creative_count}`);

console.log('\n══════════════════════════════════════');
console.log(' 场景三：重复记录验证 (PID_UNREVIEWED)');
console.log('══════════════════════════════════════');

const dupCount = (tgt.prepare("SELECT COUNT(*) as c FROM drama WHERE playlet_id = 'PID_UNREVIEWED'").get()).c;
const afterUnreviewed = tgt.prepare('SELECT * FROM drama WHERE playlet_id = ?').get('PID_UNREVIEWED');

assert(dupCount === 1, `playlet_id=PID_UNREVIEWED 只有 ${dupCount} 条记录 (期望 1)`);
assert(afterUnreviewed.title === 'Updated Unreviewed', `title 已更新 = "${afterUnreviewed.title}" (旧值 "Old Unreviewed Title")`);
assert(afterUnreviewed.is_ai_drama === null, `未审核的 is_ai_drama 仍为 null — 实际: ${afterUnreviewed.is_ai_drama}`);

const totalDramas = (tgt.prepare('SELECT COUNT(*) as c FROM drama').get()).c;
assert(totalDramas === 3, `drama 表总共 ${totalDramas} 条 (期望 3: 2 已有 + 1 新增)`);

console.log('\n══════════════════════════════════════');
console.log(' 场景四：ranking_snapshot 去重验证');
console.log('══════════════════════════════════════');

const afterSnapshotCount = (tgt.prepare('SELECT COUNT(*) as c FROM ranking_snapshot').get()).c;

// Before: 1 (PID_REVIEWED/ShortMax/2026-03-27)
// Source has 3: PID_REVIEWED/ShortMax/2026-03-28 (new), PID_REVIEWED/ShortMax/2026-03-27 (dup), PID_BRAND_NEW/MoboShort/2026-03-28 (new)
// Expected after: 1 (existing) + 2 (new) = 3, the duplicate should be ignored
assert(afterSnapshotCount === 3, `snapshot 总数 = ${afterSnapshotCount} (导入前 ${beforeSnapshotCount}, 期望 3: 1已有 + 2新增, 1重复被忽略)`);
assert(stats.ranking_inserted === 2, `实际插入 ${stats.ranking_inserted} 条 snapshot (期望 2, 1条重复被 IGNORE)`);

console.log('\n══════════════════════════════════════');
console.log(' 合并统计');
console.log('══════════════════════════════════════');
console.log(`  新增剧集: ${stats.drama_new}`);
console.log(`  更新剧集: ${stats.drama_updated}`);
console.log(`  新增快照: ${stats.ranking_inserted}`);

console.log('\n══════════════════════════════════════');
console.log(` 最终结果: ${passed} 通过, ${failed} 失败`);
console.log('══════════════════════════════════════\n');

// Cleanup
tgt.close();
fs.unlinkSync(SRC_PATH);
fs.unlinkSync(TGT_PATH);

process.exit(failed > 0 ? 1 : 0);
