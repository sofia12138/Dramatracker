import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/api-auth';
import { buildHotAnalysisReport, ReportFilters } from '@/lib/report-analysis';

export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const startDate = params.get('startDate') || '';
  const endDate = params.get('endDate') || '';

  if (!startDate || !endDate) {
    return NextResponse.json({ error: '缺少日期参数 startDate / endDate' }, { status: 400 });
  }

  const filters: ReportFilters = {
    startDate,
    endDate,
    platform: params.get('platform') || '',
    dramaType: params.get('dramaType') || '',
  };

  try {
    const report = buildHotAnalysisReport(filters);
    return NextResponse.json(report);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
