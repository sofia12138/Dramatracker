#!/usr/bin/env node
/**
 * 人工审核保护验证脚本
 *
 * 验证目标：通过 /api/sync/dramas 推送抓取数据后，
 *           drama_review 中的人工字段（is_ai_drama / genre_tags_manual / reviewed_at）
 *           绝不被覆盖。
 *
 * 使用前提：
 *   1. USE_MYSQL=true 且 MySQL 已运行
 *   2. 已有至少一条 review_status='reviewed' 的记录
 *   3. 服务已在 3000 端口运行
 *
 * 执行方式：
 *   SYNC_API_TOKEN=<token> node scripts/db/test-review-protection.js
 *   # 或配合 .env.migration
 */

const mysql = require('mysql2/promise');
const https = require('https');
const http = require('http');
const path = require('path');
const fs = require('fs');

// ─── 加载 .env.migration ──────────────────────────────────────────────────────
const envPath = path.join(process.cwd(), '.env.migration');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
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

const SERVER_URL = process.env.DT_SERVER_URL || 'http://localhost:3000';
const SYNC_TOKEN = process.env.SYNC_API_TOKEN;
const MYSQL_CONFIG = {
  host:     process.env.MYSQL_HOST || '127.0.0.1',
  port:     parseInt(process.env.MYSQL_PORT || '3306'),
  user:     process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
};

if (!SYNC_TOKEN) {
  console.error('[ERROR] 请设置 SYNC_API_TOKEN 环境变量');
  process.exit(1);
}

// ─── 工具函数 ─────────────────────────────────────────────────────────────────
const log = {
  info:  (msg) => console.log(`[INFO]  ${msg}`),
  ok:    (msg) => console.log(`[OK ✓]  ${msg}`),
  fail:  (msg) => console.error(`[FAIL✗] ${msg}`),
  sep:   ()    => console.log('─'.repeat(60)),
};

let passCount = 0;
let failCount = 0;

function assert(label, condition, detail = '') {
  if (condition) {
    log.ok(label + (detail ? ` — ${detail}` : ''));
    passCount++;
  } else {
    log.fail(label + (detail ? ` — ${detail}` : ''));
    failCount++;
  }
}

async function postJson(url, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    const opts = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SYNC_TOKEN}`,
      },
    };
    const req = (isHttps ? https : http).request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

// ─── 主逻辑 ──────────────────────────────────────────────────────────────────
async function main() {
  log.sep();
  console.log('  DramaTracker 人工审核保护验证脚本');
  log.sep();

  const conn = await mysql.createConnection(MYSQL_CONFIG);

  // ── Step 1：选一条已审核剧目 ────────────────────────────────────────────────
  log.info('Step 1: 选取已审核剧目');
  const [reviewedRows] = await conn.execute(
    `SELECT dr.drama_id, dr.is_ai_drama, dr.genre_tags_manual, dr.reviewed_at, dr.review_status,
            d.playlet_id, d.title, d.description, d.cover_url, d.creative_count
     FROM drama_review dr
     JOIN drama d ON dr.drama_id = d.id
     WHERE dr.review_status = 'reviewed' AND dr.is_ai_drama IS NOT NULL
     LIMIT 1`
  );

  if (!reviewedRows.length) {
    log.fail('未找到已审核剧目（review_status=reviewed）。请先在审核页完成至少一条审核后再运行此脚本。');
    await conn.end();
    process.exit(1);
  }

  const target = reviewedRows[0];
  log.info(`选取剧目: playlet_id=${target.playlet_id} title=${target.title}`);
  log.info(`  审核前状态: is_ai_drama=${target.is_ai_drama} review_status=${target.review_status}`);
  log.info(`  reviewed_at=${target.reviewed_at}`);
  log.info(`  genre_tags_manual=${JSON.stringify(target.genre_tags_manual)}`);

  // 记录快照
  const before = {
    is_ai_drama:       target.is_ai_drama,
    genre_tags_manual: JSON.stringify(target.genre_tags_manual),
    reviewed_at:       target.reviewed_at ? String(target.reviewed_at) : null,
    review_status:     target.review_status,
  };

  log.sep();

  // ── Step 2：推送修改过的抓取数据 ──────────────────────────────────────────
  log.info('Step 2: 推送修改后的抓取字段（模拟新一轮抓取）');
  const syncPayload = {
    source: 'protection-test',
    dramas: [{
      playlet_id:     target.playlet_id,
      title:          target.title + ' [UPDATED]',        // 改标题
      description:    '[MODIFIED BY PROTECTION TEST]',    // 改描述
      creative_count: (target.creative_count || 0) + 999, // 改素材数
      cover_url:      'https://example.com/test-cover.jpg',
      language:       'en',
    }],
  };

  const syncRes = await postJson(`${SERVER_URL}/api/sync/dramas`, syncPayload);
  log.info(`sync/dramas 响应: ${JSON.stringify(syncRes.body)}`);

  assert('sync/dramas 返回 HTTP 200', syncRes.status === 200,
    `实际 status=${syncRes.status}`);
  assert('sync/dramas 返回 updated=1', syncRes.body?.updated === 1,
    `实际 updated=${syncRes.body?.updated}`);
  assert('sync/dramas 返回 inserted=0', syncRes.body?.inserted === 0,
    `实际 inserted=${syncRes.body?.inserted}`);

  log.sep();

  // ── Step 3：验证 drama 抓取字段已更新 ────────────────────────────────────
  log.info('Step 3: 验证 drama 抓取字段已更新');
  const [dramaAfter] = await conn.execute(
    'SELECT title, description, cover_url, creative_count FROM drama WHERE playlet_id = ?',
    [target.playlet_id]
  );
  const da = dramaAfter[0];

  assert('drama.title 已更新', da?.title?.includes('[UPDATED]'),
    `实际 title=${da?.title}`);
  assert('drama.description 已更新',
    da?.description === '[MODIFIED BY PROTECTION TEST]',
    `实际 description=${da?.description}`);
  assert('drama.cover_url 已更新',
    da?.cover_url === 'https://example.com/test-cover.jpg',
    `实际 cover_url=${da?.cover_url}`);

  log.sep();

  // ── Step 4：验证 drama_review 人工字段未变 ───────────────────────────────
  log.info('Step 4: 验证 drama_review 人工审核字段未被覆盖');
  const [reviewAfter] = await conn.execute(
    `SELECT is_ai_drama, genre_tags_manual, reviewed_at, review_status
     FROM drama_review WHERE drama_id = ?`,
    [target.drama_id]
  );
  const ra = reviewAfter[0];

  const after = {
    is_ai_drama:       ra?.is_ai_drama,
    genre_tags_manual: JSON.stringify(ra?.genre_tags_manual),
    reviewed_at:       ra?.reviewed_at ? String(ra.reviewed_at) : null,
    review_status:     ra?.review_status,
  };

  assert('drama_review.is_ai_drama 未被修改',
    after.is_ai_drama === before.is_ai_drama,
    `before=${before.is_ai_drama} after=${after.is_ai_drama}`);

  assert('drama_review.genre_tags_manual 未被修改',
    after.genre_tags_manual === before.genre_tags_manual,
    `before=${before.genre_tags_manual} after=${after.genre_tags_manual}`);

  assert('drama_review.reviewed_at 未被修改',
    after.reviewed_at === before.reviewed_at,
    `before=${before.reviewed_at} after=${after.reviewed_at}`);

  assert('drama_review.review_status 未被修改',
    after.review_status === before.review_status,
    `before=${before.review_status} after=${after.review_status}`);

  log.sep();

  // ── Step 5：清理（还原 drama 抓取字段）──────────────────────────────────
  log.info('Step 5: 清理测试修改（还原 drama 抓取字段）');
  await conn.execute(
    `UPDATE drama SET title=?, description=?, cover_url=?, creative_count=?
     WHERE playlet_id=?`,
    [target.title, target.description || null, target.cover_url || null,
     target.creative_count || 0, target.playlet_id]
  );
  log.ok('drama 抓取字段已还原');

  log.sep();

  // ── 汇总 ─────────────────────────────────────────────────────────────────
  console.log(`\n验证结果：PASS=${passCount} FAIL=${failCount}`);
  if (failCount === 0) {
    console.log('✅ 人工审核保护验证通过：sync/dramas 绝不覆盖 drama_review 人工字段');
  } else {
    console.log('❌ 存在失败项，请检查上方日志');
  }

  await conn.end();
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
