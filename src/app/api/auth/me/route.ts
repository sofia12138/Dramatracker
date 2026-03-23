import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserFromRequest, getRolePermissions } from '@/lib/auth';

export async function GET(request: NextRequest) {
  const user = await getAuthUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  return NextResponse.json({
    ...user,
    permissions: getRolePermissions(user.role),
  });
}
