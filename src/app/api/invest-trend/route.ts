import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { isMysqlMode, query } from '@/lib/mysql';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const playletId = searchParams.get('playlet_id');
    const platform = searchParams.get('platform');
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');

    let whereClause = '1=1';
    const params: unknown[] = [];

    if (playletId) { whereClause += ' AND playlet_id = ?'; params.push(playletId); }
    if (platform) { whereClause += ' AND platform = ?'; params.push(platform); }
    if (startDate) { whereClause += ' AND date >= ?'; params.push(startDate); }
    if (endDate) { whereClause += ' AND date <= ?'; params.push(endDate); }

    if (isMysqlMode()) {
      // MySQL 的 invest_trend.date 是 DATE 类型；统一格式化为 'YYYY-MM-DD' 字符串
      const sql = `
        SELECT id, drama_id, playlet_id, platform,
               DATE_FORMAT(date, '%Y-%m-%d') AS date,
               daily_invest_count
        FROM invest_trend
        WHERE ${whereClause}
        ORDER BY date ASC
      `;
      const rows = await query(sql, params);
      return NextResponse.json(rows);
    }

    const db = getDb();
    const data = db.prepare(`SELECT * FROM invest_trend WHERE ${whereClause} ORDER BY date ASC`).all(...params);
    return NextResponse.json(data);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();
    const items = Array.isArray(body) ? body : [body];

    const stmt = db.prepare('INSERT OR REPLACE INTO invest_trend (playlet_id, platform, date, daily_invest_count) VALUES (?, ?, ?, ?)');
    const insertMany = db.transaction((rows: Array<Record<string, unknown>>) => {
      for (const row of rows) {
        stmt.run(row.playlet_id, row.platform, row.date, (row.daily_invest_count as number | undefined) ?? 0);
      }
    });
    insertMany(items as Array<Record<string, unknown>>);
    return NextResponse.json({ success: true, count: items.length }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
