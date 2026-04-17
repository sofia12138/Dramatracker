#!/usr/bin/env node
/**
 * SQLite -> MySQL 一次性迁移脚本
 *
 * 执行前提：
 *   1. MySQL 已按 schema.sql 建好表
 *   2. 配置好环境变量（见下方说明）
 *
 * 执行方式：
 *   node scripts/db/migrate-sqlite-to-mysql.js
 *
 * 环境变量（可放 .env.migration 或直接 export）：
 *   SQLITE_PATH   - SQLite 文件路径，默认 data/dramatracker.db
 *   MYSQL_HOST    - MySQL 主机
 *   MYSQL_PORT    - MySQL 端口，默认 3306
 *   MYSQL_USER    - MySQL 用户名
 *   MYSQL_PASSWORD- MySQL 密码
 *   MYSQL_DATABASE- MySQL 数据库名
 */

const Database = require('better-sqlite3');
const mysql = require('mysql2/promise');
const path = require('path');
const fs = require('fs');

// ─── 配置 ──────────────────────────────────────────────────────────────────────
const SQLITE_PATH = process.env.SQLITE_PATH || path.join(process.cwd(), 'data', 'dramatracker.db');
const BATCH_SIZE = 200;

// 加载 .env.migration（如果存在）
const envMigrationPath = path.join(process.cwd(), '.env.migration');
if (fs.existsSync(envMigrationPath)) {
  const lines = fs.readFileSync(envMigrationPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

// ─── 工具函数 ──────────────────────────────────────────────────────────────────
const log = {
  info:  (msg) => console.log(`[INFO]  ${new Date().toISOString()} ${msg}`),
  ok:    (msg) => console.log(`[OK]    ${new Date().toISOString()} ${msg}`),
  warn:  (msg) => console.warn(`[WARN]  ${new Date().toISOString()} ${msg}`),
  error: (msg) => console.error(`[ERROR] ${new Date().toISOString()} ${msg}`),
};

function normalizeTitle(raw) {
  return (raw || '')
    .replace(/\[Updating\]/gi, '')
    .replace(/\(Updating\)/gi, '')
    .replace(/【更新中】/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function normalizeDateStr(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return null;
}

function dedupeKey(title, language, firstAirDate) {
  const t = normalizeTitle(title);
  const l = (language || '').trim().toLowerCase();
  const d = normalizeDateStr(firstAirDate) || '';
  return `${t}|${l}|${d}`;
}

function parseJson(raw, fallback = null) {
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

function toDatetime(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (s.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)) return s;
  if (s.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)) return s.slice(0, 19).replace('T', ' ');
  if (s.match(/^\d{4}-\d{2}-\d{2}$/)) return `${s} 00:00:00`;
  return null;
}

async function batchInsert(conn, table, cols, rows) {
  if (!rows.length) return 0;
  const placeholders = `(${cols.map(() => '?').join(',')})`;
  const sql = `INSERT IGNORE INTO ${table} (${cols.join(',')}) VALUES ${rows.map(() => placeholders).join(',')}`;
  const flat = rows.flatMap(r => cols.map(c => r[c] ?? null));
  const [result] = await conn.execute(sql, flat);
  return result.affectedRows || 0;
}

// ─── 主流程 ──────────────────────────────────────────────────────────────────
async function main() {
  log.info('=== DramaTracker SQLite -> MySQL 迁移脚本 ===');

  if (!fs.existsSync(SQLITE_PATH)) {
    log.error(`SQLite 文件不存在：${SQLITE_PATH}`);
    process.exit(1);
  }

  const { MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE } = process.env;
  if (!MYSQL_HOST || !MYSQL_USER || !MYSQL_PASSWORD || !MYSQL_DATABASE) {
    log.error('缺少 MySQL 连接环境变量，请检查 MYSQL_HOST / MYSQL_USER / MYSQL_PASSWORD / MYSQL_DATABASE');
    process.exit(1);
  }

  const sqlite = new Database(SQLITE_PATH, { readonly: true });
  log.info(`已打开 SQLite：${SQLITE_PATH}`);

  const pool = mysql.createPool({
    host: MYSQL_HOST,
    port: parseInt(process.env.MYSQL_PORT || '3306'),
    user: MYSQL_USER,
    password: MYSQL_PASSWORD,
    database: MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: 5,
    timezone: '+00:00',
    charset: 'utf8mb4',
  });
  log.info('已连接 MySQL');

  const stats = {
    drama: { inserted: 0, skipped: 0 },
    drama_review: { inserted: 0, skipped: 0 },
    ranking_snapshot: { inserted: 0, skipped: 0 },
    invest_trend: { inserted: 0, skipped: 0 },
    platforms: { inserted: 0 },
    users: { inserted: 0 },
    drama_play_count: { inserted: 0, skipped: 0 },
  };

  const conn = await pool.getConnection();

  try {
    // ── 1. drama ────────────────────────────────────────────────────────────
    log.info('--- [1/7] 迁移 drama 表 ---');
    const dramas = sqlite.prepare('SELECT * FROM drama').all();
    log.info(`SQLite drama 总数：${dramas.length}`);

    // playlet_id -> MySQL drama.id 映射
    const dramaIdMap = new Map();

    for (let i = 0; i < dramas.length; i += BATCH_SIZE) {
      const batch = dramas.slice(i, i + BATCH_SIZE);
      for (const d of batch) {
        const dk = dedupeKey(d.title, d.language, d.first_air_date);
        const normalized = normalizeTitle(d.title);
        const firstAirDate = normalizeDateStr(d.first_air_date);
        const tags = parseJson(d.tags, []);
        const createdAt = toDatetime(d.created_at) || new Date().toISOString().slice(0, 19).replace('T', ' ');
        const updatedAt = toDatetime(d.updated_at) || createdAt;

        try {
          await conn.execute(
            `INSERT INTO drama
               (playlet_id, dedupe_key, title, normalized_title, description, language,
                cover_url, first_air_date, tags, creative_count,
                first_seen_at, last_seen_at, created_at, updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
             ON DUPLICATE KEY UPDATE
               title=VALUES(title), normalized_title=VALUES(normalized_title),
               description=VALUES(description), language=VALUES(language),
               cover_url=VALUES(cover_url), first_air_date=VALUES(first_air_date),
               tags=VALUES(tags), creative_count=VALUES(creative_count),
               last_seen_at=VALUES(last_seen_at), updated_at=VALUES(updated_at)`,
            [
              d.playlet_id, dk, d.title, normalized, d.description || null,
              d.language || null, d.cover_url || null, firstAirDate,
              JSON.stringify(tags), d.creative_count || 0,
              firstAirDate, firstAirDate, createdAt, updatedAt,
            ]
          );
          // 取回 MySQL id
          const [rows] = await conn.execute('SELECT id FROM drama WHERE playlet_id = ?', [d.playlet_id]);
          if (rows[0]) {
            dramaIdMap.set(d.playlet_id, rows[0].id);
            stats.drama.inserted++;
          }
        } catch (err) {
          log.warn(`drama skip playlet_id=${d.playlet_id} : ${err.message}`);
          stats.drama.skipped++;
        }
      }
      log.info(`  drama 进度：${Math.min(i + BATCH_SIZE, dramas.length)} / ${dramas.length}`);
    }
    log.ok(`drama 迁移完成：inserted=${stats.drama.inserted} skipped=${stats.drama.skipped}`);

    // ── 2. drama_review（从 drama 审核字段拆出）──────────────────────────
    log.info('--- [2/7] 迁移 drama_review（从 drama 拆分审核字段）---');
    const dramasWithReview = dramas.filter(d =>
      d.is_ai_drama || d.genre_tags_manual || d.genre_tags_ai || d.genre_source
    );
    log.info(`有审核数据的 drama：${dramasWithReview.length}`);

    for (const d of dramasWithReview) {
      const dramaId = dramaIdMap.get(d.playlet_id);
      if (!dramaId) {
        log.warn(`drama_review skip：找不到 MySQL drama_id for playlet_id=${d.playlet_id}`);
        stats.drama_review.skipped++;
        continue;
      }

      const isAiDrama = ['ai_real', 'ai_manga', 'real'].includes(d.is_ai_drama) ? d.is_ai_drama : null;
      const reviewStatus = d.is_ai_drama ? 'reviewed' : 'pending';
      const genreTagsManual = parseJson(d.genre_tags_manual, null);
      const genreTagsAi = parseJson(d.genre_tags_ai, null);
      const updatedAt = toDatetime(d.updated_at) || new Date().toISOString().slice(0, 19).replace('T', ' ');
      const reviewedAt = d.is_ai_drama ? updatedAt : null;

      try {
        await conn.execute(
          `INSERT INTO drama_review
             (drama_id, is_ai_drama, genre_tags_manual, genre_tags_ai, genre_source,
              review_status, reviewed_at, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?)
           ON DUPLICATE KEY UPDATE
             is_ai_drama=VALUES(is_ai_drama),
             genre_tags_manual=VALUES(genre_tags_manual),
             genre_tags_ai=VALUES(genre_tags_ai),
             genre_source=VALUES(genre_source),
             review_status=VALUES(review_status),
             reviewed_at=VALUES(reviewed_at),
             updated_at=VALUES(updated_at)`,
          [
            dramaId, isAiDrama,
            genreTagsManual ? JSON.stringify(genreTagsManual) : null,
            genreTagsAi ? JSON.stringify(genreTagsAi) : null,
            d.genre_source || null,
            reviewStatus, reviewedAt,
            updatedAt, updatedAt,
          ]
        );
        stats.drama_review.inserted++;
      } catch (err) {
        log.warn(`drama_review skip drama_id=${dramaId} : ${err.message}`);
        stats.drama_review.skipped++;
      }
    }
    log.ok(`drama_review 迁移完成：inserted=${stats.drama_review.inserted} skipped=${stats.drama_review.skipped}`);

    // ── 3. ranking_snapshot ────────────────────────────────────────────────
    log.info('--- [3/7] 迁移 ranking_snapshot ---');
    const snapshots = sqlite.prepare('SELECT * FROM ranking_snapshot').all();
    log.info(`SQLite ranking_snapshot 总数：${snapshots.length}`);

    for (let i = 0; i < snapshots.length; i += BATCH_SIZE) {
      const batch = snapshots.slice(i, i + BATCH_SIZE);
      for (const s of batch) {
        const dramaId = dramaIdMap.get(s.playlet_id);
        if (!dramaId) {
          stats.ranking_snapshot.skipped++;
          continue;
        }
        const dateKey = normalizeDateStr(s.snapshot_date);
        if (!dateKey) { stats.ranking_snapshot.skipped++; continue; }

        try {
          await conn.execute(
            `INSERT INTO ranking_snapshot
               (drama_id, playlet_id, platform, ranking_type, date_key,
                rank_position, heat_value, material_count, invest_days, created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?)
             ON DUPLICATE KEY UPDATE
               rank_position=VALUES(rank_position),
               heat_value=VALUES(heat_value),
               material_count=VALUES(material_count),
               invest_days=VALUES(invest_days)`,
            [
              dramaId, s.playlet_id, s.platform, 'heat', dateKey,
              s.rank || 0, s.heat_value || 0,
              s.material_count || 0, s.invest_days || 0,
              new Date().toISOString().slice(0, 19).replace('T', ' '),
            ]
          );
          stats.ranking_snapshot.inserted++;
        } catch (err) {
          stats.ranking_snapshot.skipped++;
        }
      }
      if ((i / BATCH_SIZE) % 10 === 0) {
        log.info(`  ranking_snapshot 进度：${Math.min(i + BATCH_SIZE, snapshots.length)} / ${snapshots.length}`);
      }
    }
    log.ok(`ranking_snapshot 迁移完成：inserted=${stats.ranking_snapshot.inserted} skipped=${stats.ranking_snapshot.skipped}`);

    // ── 4. invest_trend ────────────────────────────────────────────────────
    log.info('--- [4/7] 迁移 invest_trend ---');
    const trends = sqlite.prepare('SELECT * FROM invest_trend').all();
    log.info(`SQLite invest_trend 总数：${trends.length}`);

    for (let i = 0; i < trends.length; i += BATCH_SIZE) {
      const batch = trends.slice(i, i + BATCH_SIZE);
      for (const t of batch) {
        const dramaId = dramaIdMap.get(t.playlet_id);
        if (!dramaId) { stats.invest_trend.skipped++; continue; }
        const date = normalizeDateStr(t.date);
        if (!date) { stats.invest_trend.skipped++; continue; }

        try {
          await conn.execute(
            `INSERT INTO invest_trend (drama_id, playlet_id, platform, date, daily_invest_count)
             VALUES (?,?,?,?,?)
             ON DUPLICATE KEY UPDATE daily_invest_count=VALUES(daily_invest_count)`,
            [dramaId, t.playlet_id, t.platform, date, t.daily_invest_count || 0]
          );
          stats.invest_trend.inserted++;
        } catch (err) {
          stats.invest_trend.skipped++;
        }
      }
    }
    log.ok(`invest_trend 迁移完成：inserted=${stats.invest_trend.inserted} skipped=${stats.invest_trend.skipped}`);

    // ── 5. platforms ───────────────────────────────────────────────────────
    log.info('--- [5/7] 迁移 platforms ---');
    const plats = sqlite.prepare('SELECT * FROM platforms').all();
    for (const p of plats) {
      try {
        await conn.execute(
          'INSERT IGNORE INTO platforms (name, product_ids, is_active) VALUES (?,?,?)',
          [p.name, p.product_ids || '[]', p.is_active ?? 1]
        );
        stats.platforms.inserted++;
      } catch {}
    }
    log.ok(`platforms 迁移完成：inserted=${stats.platforms.inserted}`);

    // ── 6. users ───────────────────────────────────────────────────────────
    log.info('--- [6/7] 迁移 users ---');
    const sqliteUsers = sqlite.prepare('SELECT * FROM users').all();
    for (const u of sqliteUsers) {
      try {
        await conn.execute(
          `INSERT IGNORE INTO users (username, password, name, role, is_active, created_at, last_login_at)
           VALUES (?,?,?,?,?,?,?)`,
          [u.username, u.password, u.name, u.role, u.is_active ?? 1,
           toDatetime(u.created_at), toDatetime(u.last_login_at)]
        );
        stats.users.inserted++;
      } catch {}
    }
    log.ok(`users 迁移完成：inserted=${stats.users.inserted}`);

    // ── 7. drama_play_count ────────────────────────────────────────────────
    log.info('--- [7/7] 迁移 drama_play_count ---');
    let playCounts = [];
    try { playCounts = sqlite.prepare('SELECT * FROM drama_play_count').all(); } catch {}
    log.info(`SQLite drama_play_count 总数：${playCounts.length}`);
    for (const pc of playCounts) {
      const dramaId = dramaIdMap.get(pc.playlet_id);
      if (!dramaId) { stats.drama_play_count.skipped++; continue; }
      try {
        await conn.execute(
          `INSERT IGNORE INTO drama_play_count
             (drama_id, playlet_id, platform, app_play_count, record_week, record_date, input_by, note)
           VALUES (?,?,?,?,?,?,?,?)`,
          [dramaId, pc.playlet_id, pc.platform, pc.app_play_count || 0,
           pc.record_week, normalizeDateStr(pc.record_date), pc.input_by, pc.note]
        );
        stats.drama_play_count.inserted++;
      } catch {
        stats.drama_play_count.skipped++;
      }
    }
    log.ok(`drama_play_count 迁移完成：inserted=${stats.drama_play_count.inserted} skipped=${stats.drama_play_count.skipped}`);

  } finally {
    conn.release();
  }

  // ── 校验 ──────────────────────────────────────────────────────────────────
  log.info('--- 迁移校验 ---');
  const [mysqlDrama]    = await pool.execute('SELECT COUNT(*) as c FROM drama');
  const [mysqlReview]   = await pool.execute('SELECT COUNT(*) as c FROM drama_review');
  const [mysqlSnapshot] = await pool.execute('SELECT COUNT(*) as c FROM ranking_snapshot');
  const [mysqlTrend]    = await pool.execute('SELECT COUNT(*) as c FROM invest_trend');

  const sqliteDramaCount    = sqlite.prepare('SELECT COUNT(*) as c FROM drama').get().c;
  const sqliteSnapshotCount = sqlite.prepare('SELECT COUNT(*) as c FROM ranking_snapshot').get().c;
  const sqliteTrendCount    = sqlite.prepare('SELECT COUNT(*) as c FROM invest_trend').get().c;

  console.log('\n┌─────────────────────────────────────────────────────┐');
  console.log('│              迁移结果校验                            │');
  console.log('├────────────────────┬──────────────┬────────────────┤');
  console.log('│ 表                 │ SQLite 原始  │ MySQL 迁移后   │');
  console.log('├────────────────────┼──────────────┼────────────────┤');
  console.log(`│ drama              │ ${String(sqliteDramaCount).padEnd(12)} │ ${String(mysqlDrama[0].c).padEnd(14)} │`);
  console.log(`│ drama_review       │ (拆分自drama)│ ${String(mysqlReview[0].c).padEnd(14)} │`);
  console.log(`│ ranking_snapshot   │ ${String(sqliteSnapshotCount).padEnd(12)} │ ${String(mysqlSnapshot[0].c).padEnd(14)} │`);
  console.log(`│ invest_trend       │ ${String(sqliteTrendCount).padEnd(12)} │ ${String(mysqlTrend[0].c).padEnd(14)} │`);
  console.log('└────────────────────┴──────────────┴────────────────┘\n');

  // 样本抽查
  const [sample] = await pool.execute(
    `SELECT d.playlet_id, d.title, dr.is_ai_drama, dr.review_status
     FROM drama d LEFT JOIN drama_review dr ON d.id = dr.drama_id LIMIT 3`
  );
  console.log('样本抽查（前3条）：');
  for (const row of sample) {
    console.log(`  ${row.playlet_id} | ${row.title} | is_ai_drama=${row.is_ai_drama} | status=${row.review_status}`);
  }

  await pool.end();
  sqlite.close();
  log.ok('=== 迁移完成 ===');
}

main().catch(err => {
  log.error(`迁移失败：${err.message}`);
  console.error(err);
  process.exit(1);
});
