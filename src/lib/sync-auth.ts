/**
 * 同步 API 鉴权：Bearer Token
 * token 从环境变量 SYNC_API_TOKEN 读取。
 */
import { NextRequest, NextResponse } from 'next/server';

export function checkSyncAuth(request: NextRequest): NextResponse | null {
  const token = process.env.SYNC_API_TOKEN;
  if (!token) {
    console.error('[sync-auth] SYNC_API_TOKEN 未配置，拒绝所有同步请求');
    return NextResponse.json({ error: '同步接口未启用' }, { status: 503 });
  }

  const authHeader = request.headers.get('Authorization') || '';
  const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  if (provided !== token) {
    console.warn(`[sync-auth] 未授权的同步请求 from ${request.headers.get('x-forwarded-for') || 'unknown'}`);
    return NextResponse.json({ error: '未授权' }, { status: 401 });
  }

  return null; // 通过
}
