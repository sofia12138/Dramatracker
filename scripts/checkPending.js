const db = require('better-sqlite3')('data/dramatracker.db', { readonly: true });

const total = db.prepare('SELECT COUNT(*) as c FROM drama WHERE is_ai_drama IS NULL').get();
console.log('\n=== 待审核总数 ===');
console.log(total.c, '部\n');

console.log('=== 按平台分组 ===');
const platforms = db.prepare(`
  SELECT rs.platform, COUNT(DISTINCT d.id) as count
  FROM ranking_snapshot rs
  INNER JOIN drama d ON rs.playlet_id = d.playlet_id
  WHERE d.is_ai_drama IS NULL
  GROUP BY rs.platform ORDER BY count DESC
`).all();
console.table(platforms);

console.log('\n=== 全部待审核短剧 ===');
const all = db.prepare(`
  SELECT d.id, d.playlet_id, d.title,
    COALESCE(GROUP_CONCAT(DISTINCT rs.platform), '-') as platforms
  FROM drama d
  LEFT JOIN ranking_snapshot rs ON d.playlet_id = rs.playlet_id
  WHERE d.is_ai_drama IS NULL
  GROUP BY d.id
  ORDER BY d.id
`).all();
console.table(all);

db.close();
