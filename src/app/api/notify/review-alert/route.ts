import { NextResponse } from 'next/server';
import { getPendingReviewCounts } from '@/lib/review-count';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const rawUrl = process.env.FEISHU_WEBHOOK_URL || '';
  const webhookUrl = rawUrl.trim().replace(/[\r\n]/g, '');

  const maskedUrl = webhookUrl.length > 20
    ? webhookUrl.slice(0, 15) + '***' + webhookUrl.slice(-6)
    : webhookUrl || '(empty)';
  console.log(`[feishu-alert] webhook URL: ${maskedUrl} (len=${webhookUrl.length})`);

  if (!webhookUrl) {
    return NextResponse.json(
      { error: '飞书 Webhook 未配置，请在 .env.local 中设置 FEISHU_WEBHOOK_URL' },
      { status: 500 }
    );
  }

  try {
    // 与 /api/drama/pending-count、审核页使用同一套统计，避免 MySQL 模式下飞书读 SQLite 导致数字不一致
    const { total: count, platformCounts: platformRows } = await getPendingReviewCounts();

    if (count === 0) {
      return NextResponse.json({ success: true, count: 0, notified: false, message: '当前无待审核短剧' });
    }

    const platformDetail = platformRows.map(r => `  ${r.platform}: ${r.count}部`).join('\n');

    const text = [
      `⚠️ 当前有 ${count} 条待审核短剧，请及时处理。`,
      '',
      '平台分布：',
      platformDetail,
      '',
      `🔗 审核地址：${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/review`,
    ].join('\n');

    console.log(`[feishu-alert] 发送请求 -> ${maskedUrl}`);
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg_type: 'text', content: { text } }),
    });

    const body = await res.text();
    console.log(`[feishu-alert] 飞书响应: status=${res.status} ${res.statusText} body=${body.slice(0, 200)}`);

    if (!res.ok) {
      return NextResponse.json(
        { error: `飞书推送失败: ${res.status} ${res.statusText}`, detail: body },
        { status: 502 }
      );
    }

    return NextResponse.json({ success: true, count, notified: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
