import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import bcrypt from 'bcryptjs';

export async function GET() {
  try {
    const db = getDb();
    const users = db.prepare('SELECT id, username, name, role, is_active, created_at, updated_at, last_login_at FROM users ORDER BY id ASC').all();
    return NextResponse.json(users);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();
    const hashedPassword = bcrypt.hashSync(body.password, 10);
    const result = db.prepare('INSERT INTO users (username, password, name, role) VALUES (?, ?, ?, ?)')
      .run(body.username, hashedPassword, body.name || null, body.role || 'operation');
    return NextResponse.json({ id: result.lastInsertRowid }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
