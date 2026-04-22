import { NextResponse } from 'next/server';
import { forceCloseDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST() {
  const result = forceCloseDb();
  console.log('[debug] forceCloseDb called:', result);
  return NextResponse.json(result);
}
