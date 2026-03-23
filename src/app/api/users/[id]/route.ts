import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import bcrypt from 'bcryptjs';

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const db = getDb();
    const body = await request.json();

    if (body.password) {
      const hashedPassword = bcrypt.hashSync(body.password, 10);
      db.prepare("UPDATE users SET username=?, password=?, name=?, role=?, is_active=?, updated_at=datetime('now') WHERE id=?")
        .run(body.username, hashedPassword, body.name, body.role, body.is_active ?? 1, params.id);
    } else {
      db.prepare("UPDATE users SET username=?, name=?, role=?, is_active=?, updated_at=datetime('now') WHERE id=?")
        .run(body.username, body.name, body.role, body.is_active ?? 1, params.id);
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const db = getDb();
    db.prepare('DELETE FROM users WHERE id = ?').run(params.id);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
