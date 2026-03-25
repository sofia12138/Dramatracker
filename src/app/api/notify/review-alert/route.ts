import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const webhookUrl = process.env.FEISHU_WEBHOOK_URL;
  if (!webhookUrl) {
    return NextResponse.json(
      { error: '飞书 Webhook 未配置，请在 .env.local 中设置 FEISHU_WEBHOOK_URL' },
      { status: 500 }
    );
  }

  try {
    const db = getDb();
    const { count } = db.prepare(
      'SELECT COUNT(*) as count FROM drama WHERE is_ai_drama IS NULL'
    ).get() as { count: number };

    if (count === 0) {
      return NextResponse.json({ success: true, count: 0, notified: false, message: '当前无待审核短剧' });
    }

    const platformRows = db.prepare(`
      SELECT rs.platform, COUNT(DISTINCT rs.playlet_id) as cnt
      FROM ranking_snapshot rs
      INNER JOIN drama d ON rs.playlet_id = d.playlet_id
      WHERE d.is_ai_drama IS NULL
      GROUP BY rs.platform ORDER BY cnt DESC
    `).all() as { platform: string; cnt: number }[];

    const platformDetail = platformRows.map(r => `  ${r.platform}: ${r.cnt}部`).join('\n');

    const text = [
      `⚠️ 当前有 ${count} 条待审核短剧，请及时处理。`,
      '',
      '平台分布：',
      platformDetail,
      '',
      `🔗 审核地址：${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/review`,
    ].join('\n');

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg_type: 'text', content: { text } }),
    });

    if (!res.ok) {
      const body = await res.text();
      return NextResponse.json(
        { error: `飞书推送失败: ${res.status}`, detail: body },
        { status: 502 }
      );
    }

    return NextResponse.json({ success: true, count, notified: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
