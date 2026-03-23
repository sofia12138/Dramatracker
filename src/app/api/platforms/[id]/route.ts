import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { checkPermission, isErrorResponse } from '@/lib/api-auth';

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = checkPermission(request, 'manage_settings');
  if (isErrorResponse(auth)) return auth;

  try {
    const db = getDb();
    const body = await request.json();
    db.prepare('UPDATE platforms SET name=?, product_ids=?, is_active=? WHERE id=?')
      .run(body.name, JSON.stringify(body.product_ids || []), body.is_active ?? 1, params.id);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = checkPermission(request, 'manage_settings');
  if (isErrorResponse(auth)) return auth;

  try {
    const db = getDb();
    db.prepare('DELETE FROM platforms WHERE id = ?').run(params.id);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
