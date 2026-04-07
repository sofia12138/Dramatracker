import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/api-auth';
import { buildMarketInsightReport, type ReportFilters } from '@/lib/report-analysis';
import { buildMarketReportDocx } from '@/lib/report-docx';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseFilters(params: URLSearchParams): ReportFilters | { error: string } {
  const startDate = params.get('startDate') ?? params.get('start_date') ?? '';
  const endDate = params.get('endDate') ?? params.get('end_date') ?? '';

  if (!startDate || !endDate) return { error: '缺少必要参数：startDate 和 endDate 不能为空' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate))
    return { error: '日期格式无效，请使用 YYYY-MM-DD 格式' };
  if (startDate > endDate) return { error: 'startDate 不能晚于 endDate' };

  return {
    startDate,
    endDate,
    platform: params.get('platform') ?? '',
    dramaType: params.get('dramaType') ?? params.get('drama_type') ?? '',
  };
}

export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const filters = parseFilters(new URL(request.url).searchParams);
  if ('error' in filters) return NextResponse.json({ error: filters.error }, { status: 400 });

  try {
    const report = buildMarketInsightReport(filters);
    const buffer = await buildMarketReportDocx(report);

    const platform = filters.platform && filters.platform !== 'all' ? `-${filters.platform}` : '';
    const filename = `market-insight${platform}-${filters.startDate}_to_${filters.endDate}.docx`;

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
