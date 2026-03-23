import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { checkPermission, isErrorResponse } from '@/lib/api-auth';

const CONFIG_PATH = path.join(process.cwd(), 'data', 'config.json');

export async function POST(request: NextRequest) {
  const auth = checkPermission(request, 'manage_settings');
  if (isErrorResponse(auth)) return auth;

  try {
    let config = { ai_api_key: '', ai_base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', ai_model: 'qwen3.5-plus' };
    try {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
      config = { ...config, ...JSON.parse(raw) };
    } catch { /* use defaults */ }

    if (!config.ai_api_key) {
      return NextResponse.json({ success: false, message: 'API Key 未配置' });
    }

    const res = await fetch(`${config.ai_base_url}/models`, {
      headers: { 'Authorization': `Bearer ${config.ai_api_key}` },
      signal: AbortSignal.timeout(10000),
    });

    if (res.ok) {
      return NextResponse.json({ success: true, message: '连接成功' });
    }
    return NextResponse.json({ success: false, message: `连接失败: HTTP ${res.status}` });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, message: `连接失败: ${message}` });
  }
}
