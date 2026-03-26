import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { checkPermission, isErrorResponse } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CONFIG_PATH = path.join(process.cwd(), 'data', 'config.json');
const SIGN_SALT = 'g:%w0k7&q1v9^tRnLz!M';
const TEST_URL = 'https://oversea-v2.dataeye.com/api/product/listPlayletDistribution';

function computeSign(params: Record<string, string | number>): string {
  const filtered = Object.entries(params).filter(([k]) => k !== 'sign');
  filtered.sort(([a], [b]) => a.localeCompare(b));
  const raw = filtered.map(([k, v]) => `${k}=${v}`).join('&') + `&key=${SIGN_SALT}`;
  return crypto.createHash('md5').update(raw).digest('hex').toUpperCase();
}

export async function POST(request: NextRequest) {
  const auth = checkPermission(request, 'manage_settings');
  if (isErrorResponse(auth)) return auth;

  try {
    let cookie = '';
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      cookie = raw.cookie || '';
    }

    if (!cookie) {
      return NextResponse.json({ status: 'none', message: 'Cookie 未配置' });
    }

    const thisTimes = String(Date.now());
    const params: Record<string, string | number> = {
      pageId: 1,
      pageSize: 1,
      dimDate: 7,
      productId: 365084,
      thisTimes,
    };
    params.sign = computeSign(params);

    const body = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

    const res = await fetch(TEST_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'Content-Language': 'zh-cn',
        'Cookie': cookie,
      },
      body,
    });

    const data = await res.json();

    if (data.statusCode === 200 && data.msg === 'success') {
      return NextResponse.json({ status: 'valid', message: 'Cookie 有效' });
    }

    return NextResponse.json({ status: 'expired', message: data.msg || 'Cookie 已失效' });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ status: 'error', message: `检测失败: ${msg}` });
  }
}
