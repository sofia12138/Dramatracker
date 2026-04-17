#!/usr/bin/env node
/**
 * validate-migration.js
 * 迁移后数据校验脚本（独立于迁移脚本，可随时重复执行）
 *
 * 校验内容：
 *   1. drama / drama_review / ranking_snapshot 条数比对
 *   2. 拆表后审核字段命中率检查（is_ai_drama 覆盖率）
 *   3. 样本抽查（前 5 条 + 随机 3 条）
 *   4. 孤儿记录检查（drama_review 无对应 drama）
 *   5. 榜单快照完整性（每日每平台条数分布）
 *
 * 执行方式：
 *   node scripts/db/validate-migration.js
 *
 * 环境变量（.env.migration 或直接 export）：
 *   SQLITE_PATH     SQLite 文件路径
 *   MYSQL_HOST / MYSQL_PORT / MYSQL_USER / MYSQL_PASSWORD / MYSQL_DATABASE
 */

const Database = require('better-sqlite3');
const mysql = require('mysql2/promise');
const path = require('path');
const fs = require('fs');

// ── 加载 .env.migration ────────────────────────────────────────────────────────
const envPath = path.join(process.cwd(), '.env.migration');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq > 0) {
      const k = t.slice(0, eq).trim();
      const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[k]) process.env[k] = v;
    }
  }
}

const SQLITE_PATH = process.env.SQLITE_PATH || path.join(process.cwd(), 'data', 'dramatracker.db');

const PASS = '✅ PASS';
const FAIL = '❌ FAIL';
const WARN = '⚠️  WARN';

let passCount = 0, failCount = 0, warnCount = 0;

function check(label, ok, detail = '') {
  if (ok === true)  { console.log(`${PASS}  ${label}${detail ? ` (${detail})` : ''}`); passCount++; }
  else if (ok === false) { console.log(`${FAIL}  ${label}${detail ? ` → ${detail}` : ''}`); failCount++; }
  else             { console.log(`${WARN}  ${label}${detail ? ` → ${detail}` : ''}`); warnCount++; }
}

function section(title) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('─'.repeat(60));
}

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║        DramaTracker MySQL 迁移数据校验报告               ║');
  console.log(`║  时间: ${new Date().toISOString()}        ║`);
  console.log('╚══════════════════════════════════════════════════════════╝');

  // ── 连接 ──────────────────────────────────────────────────────────────────
  if (!fs.existsSync(SQLITE_PATH)) {
    console.error(`\n${FAIL} SQLite 文件不存在: ${SQLITE_PATH}`);
    process.exit(1);
  }
  const sqlite = new Database(SQLITE_PATH, { readonly: true });

  const { MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE } = process.env;
  if (!MYSQL_HOST || !MYSQL_USER || !MYSQL_PASSWORD || !MYSQL_DATABASE) {
    console.error(`\n${FAIL} 缺少 MySQL 环境变量`);
    process.exit(1);
  }

  const pool = mysql.createPool({
    host: MYSQL_HOST, port: parseInt(process.env.MYSQL_PORT || '3306'),
    user: MYSQL_USER, password: MYSQL_PASSWORD, database: MYSQL_DATABASE,
    waitForConnections: true, connectionLimit: 3, timezone: '+00:00',
  });

  async function mq(sql, params = []) {
    const [rows] = await pool.execute(sql, params);
    return rows;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  section('1. 条数比对：drama 表');
  // ═══════════════════════════════════════════════════════════════════════════
  const sqliteDramaCount = sqlite.prepare('SELECT COUNT(*) as c FROM drama').get().c;
  const [mysqlDramaRow] = await mq('SELECT COUNT(*) as c FROM drama');
  const mysqlDramaCount = mysqlDramaRow.c;

  check(
    `drama 条数 SQLite=${sqliteDramaCount} MySQL=${mysqlDramaCount}`,
    mysqlDramaCount >= sqliteDramaCount * 0.95,
    mysqlDramaCount < sqliteDramaCount ? `差异 ${sqliteDramaCount - mysqlDramaCount} 条（可能有重复被合并）` : '正常'
  );

  // ═══════════════════════════════════════════════════════════════════════════
  section('2. 条数比对：drama_review（拆表后）');
  // ═══════════════════════════════════════════════════════════════════════════
  const [mysqlReviewRow] = await mq('SELECT COUNT(*) as c FROM drama_review');
  const mysqlReviewCount = mysqlReviewRow.c;

  // SQLite 中有 is_ai_drama 的记录应成为 drama_review（reviewed）
  const sqliteReviewedCount = sqlite.prepare("SELECT COUNT(*) as c FROM drama WHERE is_ai_drama IS NOT NULL").get().c;
  // SQLite 中 is_ai_drama IS NULL 的记录应成为 drama_review（pending）
  const sqlitePendingCount = sqlite.prepare("SELECT COUNT(*) as c FROM drama WHERE is_ai_drama IS NULL").get().c;

  console.log(`  SQLite: 已审核=${sqliteReviewedCount} 待审核=${sqlitePendingCount} 合计=${sqliteDramaCount}`);
  console.log(`  MySQL drama_review 总行数: ${mysqlReviewCount}`);

  check(
    `drama_review 行数覆盖率`,
    mysqlReviewCount >= sqliteDramaCount * 0.9,
    `${Math.round((mysqlReviewCount / sqliteDramaCount) * 100)}%`
  );

  const [mysqlReviewedRow] = await mq("SELECT COUNT(*) as c FROM drama_review WHERE review_status='reviewed'");
  const [mysqlPendingRow] = await mq("SELECT COUNT(*) as c FROM drama_review WHERE review_status='pending' OR is_ai_drama IS NULL");

  console.log(`  MySQL: reviewed=${mysqlReviewedRow.c} pending=${mysqlPendingRow.c}`);

  check(
    `已审核数量 SQLite=${sqliteReviewedCount} MySQL=${mysqlReviewedRow.c}`,
    Math.abs(mysqlReviewedRow.c - sqliteReviewedCount) <= Math.max(5, sqliteReviewedCount * 0.02),
    '允许 2% 误差'
  );

  // is_ai_drama 命中率（审核覆盖率）
  const [aiRealRow] = await mq("SELECT COUNT(*) as c FROM drama_review WHERE is_ai_drama='ai_real'");
  const [aiMangaRow] = await mq("SELECT COUNT(*) as c FROM drama_review WHERE is_ai_drama='ai_manga'");
  const [aiRealSqliteRow] = await mq("SELECT 0 as c"); // placeholder
  const sqliteAiRealCount = sqlite.prepare("SELECT COUNT(*) as c FROM drama WHERE is_ai_drama='ai_real'").get().c;
  const sqliteAiMangaCount = sqlite.prepare("SELECT COUNT(*) as c FROM drama WHERE is_ai_drama='ai_manga'").get().c;

  console.log(`  is_ai_drama 分布:`);
  console.log(`    ai_real:  SQLite=${sqliteAiRealCount} MySQL=${aiRealRow.c}`);
  console.log(`    ai_manga: SQLite=${sqliteAiMangaCount} MySQL=${aiMangaRow.c}`);

  check('is_ai_drama=ai_real 命中', Math.abs(aiRealRow.c - sqliteAiRealCount) <= Math.max(3, sqliteAiRealCount * 0.02));
  check('is_ai_drama=ai_manga 命中', Math.abs(aiMangaRow.c - sqliteAiMangaCount) <= Math.max(3, sqliteAiMangaCount * 0.02));

  // ═══════════════════════════════════════════════════════════════════════════
  section('3. 条数比对：ranking_snapshot');
  // ═══════════════════════════════════════════════════════════════════════════
  const sqliteSnapshotCount = sqlite.prepare('SELECT COUNT(*) as c FROM ranking_snapshot').get().c;
  const [mysqlSnapshotRow] = await mq('SELECT COUNT(*) as c FROM ranking_snapshot');

  check(
    `ranking_snapshot 条数 SQLite=${sqliteSnapshotCount} MySQL=${mysqlSnapshotRow.c}`,
    Math.abs(mysqlSnapshotRow.c - sqliteSnapshotCount) / Math.max(sqliteSnapshotCount, 1) <= 0.05,
    '允许 5% 误差'
  );

  // 日期范围比对
  const sqliteDateRange = sqlite.prepare('SELECT MIN(snapshot_date) as min, MAX(snapshot_date) as max FROM ranking_snapshot').get();
  const [mysqlDateRange] = await mq('SELECT MIN(date_key) as min, MAX(date_key) as max FROM ranking_snapshot');

  console.log(`  SQLite 日期范围: ${sqliteDateRange.min} ~ ${sqliteDateRange.max}`);
  console.log(`  MySQL  日期范围: ${mysqlDateRange.min} ~ ${mysqlDateRange.max}`);

  check(
    '最新快照日期一致',
    sqliteDateRange.max === mysqlDateRange.max,
    `SQLite=${sqliteDateRange.max} MySQL=${mysqlDateRange.max}`
  );

  // ═══════════════════════════════════════════════════════════════════════════
  section('4. 孤儿记录检查');
  // ═══════════════════════════════════════════════════════════════════════════

  // drama_review 无对应 drama
  const [orphanReviewRow] = await mq(
    'SELECT COUNT(*) as c FROM drama_review dr LEFT JOIN drama d ON dr.drama_id = d.id WHERE d.id IS NULL'
  );
  check('drama_review 无孤儿记录', orphanReviewRow.c === 0, `孤儿数量: ${orphanReviewRow.c}`);

  // ranking_snapshot 无对应 drama
  const [orphanSnapshotRow] = await mq(
    'SELECT COUNT(*) as c FROM ranking_snapshot rs LEFT JOIN drama d ON rs.drama_id = d.id WHERE d.id IS NULL'
  );
  check('ranking_snapshot 无孤儿记录', orphanSnapshotRow.c === 0, `孤儿数量: ${orphanSnapshotRow.c}`);

  // ═══════════════════════════════════════════════════════════════════════════
  section('5. 榜单快照每日分布（近7天）');
  // ═══════════════════════════════════════════════════════════════════════════
  const snapshotByDate = await mq(
    `SELECT date_key, COUNT(*) as c FROM ranking_snapshot
     WHERE date_key >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
     GROUP BY date_key ORDER BY date_key DESC LIMIT 7`
  );
  if (snapshotByDate.length === 0) {
    check('近7天快照', null, '无数据（数据库可能为空或日期为历史）');
  } else {
    const avgCount = snapshotByDate.reduce((sum, r) => sum + r.c, 0) / snapshotByDate.length;
    for (const row of snapshotByDate) {
      const ratio = row.c / avgCount;
      const ok = ratio >= 0.5;
      check(`快照 ${row.date_key}: ${row.c} 条`, ok, ok ? '' : `低于均值50%（avg=${Math.round(avgCount)}）`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  section('6. 样本抽查（审核数据完整性）');
  // ═══════════════════════════════════════════════════════════════════════════
  const samples = await mq(
    `SELECT d.id, d.playlet_id, d.title, dr.is_ai_drama, dr.review_status,
            dr.genre_source, dr.reviewed_at
     FROM drama d
     LEFT JOIN drama_review dr ON d.id = dr.drama_id
     WHERE dr.is_ai_drama IS NOT NULL
     ORDER BY dr.reviewed_at DESC LIMIT 5`
  );

  if (samples.length === 0) {
    check('样本抽查', null, '未找到已审核记录，请确认迁移是否已执行');
  } else {
    console.log('\n  已审核剧目样本（最新5条）：');
    for (const row of samples) {
      console.log(`    ├ [${row.is_ai_drama}] ${row.title}`);
      console.log(`    │  playlet_id=${row.playlet_id} status=${row.review_status} source=${row.genre_source || '-'}`);
    }
    check('样本审核字段完整性', samples.every(r => r.is_ai_drama && r.review_status));
  }

  // 随机3条待审核
  const pendingSamples = await mq(
    `SELECT d.id, d.playlet_id, d.title, dr.review_status
     FROM drama d LEFT JOIN drama_review dr ON d.id = dr.drama_id
     WHERE dr.is_ai_drama IS NULL
     ORDER BY RAND() LIMIT 3`
  );
  if (pendingSamples.length > 0) {
    console.log('\n  待审核剧目样本（随机3条）：');
    for (const row of pendingSamples) {
      console.log(`    ├ [PENDING] ${row.title} (${row.playlet_id})`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  section('7. 综合汇总');
  // ═══════════════════════════════════════════════════════════════════════════

  console.log(`
  ┌─────────────────────────────────────────────────────────┐
  │ 校验结果汇总                                              │
  ├──────────────┬────────────────────────────────────────── │
  │ ✅ PASS      │ ${String(passCount).padEnd(40)}│
  │ ❌ FAIL      │ ${String(failCount).padEnd(40)}│
  │ ⚠️  WARN      │ ${String(warnCount).padEnd(40)}│
  └──────────────┴─────────────────────────────────────────── ┘
  `);

  if (failCount > 0) {
    console.log('❌ 存在校验失败项，请检查后再切换 USE_MYSQL=true\n');
    process.exit(1);
  } else if (warnCount > 0) {
    console.log('⚠️  存在警告项，请评估后再切换生产流量\n');
  } else {
    console.log('✅ 全部校验通过，可以安全切换 USE_MYSQL=true\n');
  }

  await pool.end();
  sqlite.close();
}

main().catch(err => {
  console.error('\n[ERROR] 校验脚本异常：', err.message);
  process.exit(1);
});
