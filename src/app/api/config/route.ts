import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const CONFIG_PATH = path.join(process.cwd(), 'data', 'config.json');

interface AppConfig {
  cookie: string;
  cookie_updated_at: string;
  auto_fetch_enabled: boolean;
  auto_fetch_time: string;
  ai_api_key: string;
  ai_model: string;
  ai_base_url: string;
}

function readConfig(): AppConfig {
  const defaults: AppConfig = {
    cookie: '',
    cookie_updated_at: '',
    auto_fetch_enabled: false,
    auto_fetch_time: '09:00',
    ai_api_key: '',
    ai_model: 'qwen3.5-plus',
    ai_base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  };

  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
      return { ...defaults, ...JSON.parse(raw) };
    }
  } catch { /* use defaults */ }
  return defaults;
}

function writeConfig(config: AppConfig) {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

export async function GET() {
  try {
    const config = readConfig();
    return NextResponse.json({
      ...config,
      ai_api_key: config.ai_api_key ? '***' + config.ai_api_key.slice(-4) : '',
      cookie_status: config.cookie
        ? (config.cookie_updated_at ? 'valid' : 'valid')
        : 'none',
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const config = readConfig();

    if (body.cookie !== undefined) {
      config.cookie = body.cookie;
      config.cookie_updated_at = new Date().toISOString();
    }
    if (body.auto_fetch_enabled !== undefined) config.auto_fetch_enabled = body.auto_fetch_enabled;
    if (body.auto_fetch_time !== undefined) config.auto_fetch_time = body.auto_fetch_time;
    if (body.ai_api_key !== undefined) config.ai_api_key = body.ai_api_key;

    writeConfig(config);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
