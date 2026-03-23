import { NextRequest, NextResponse } from 'next/server';
import { hasPermission, type Permission } from './auth';

export interface RequestUser {
  id: number;
  username: string;
  name: string;
  role: string;
}

export function getUserFromRequest(request: NextRequest): RequestUser | null {
  const id = request.headers.get('x-user-id');
  const role = request.headers.get('x-user-role');
  const username = request.headers.get('x-user-username');
  const name = request.headers.get('x-user-name');
  if (!id || !role) return null;
  return {
    id: parseInt(id),
    username: username || '',
    name: decodeURIComponent(name || ''),
    role,
  };
}

export function checkPermission(request: NextRequest, permission: Permission): RequestUser | NextResponse {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!hasPermission(user.role, permission)) {
    return NextResponse.json({ error: '没有权限执行此操作' }, { status: 403 });
  }
  return user;
}

export function isErrorResponse(result: RequestUser | NextResponse): result is NextResponse {
  return result instanceof NextResponse;
}
