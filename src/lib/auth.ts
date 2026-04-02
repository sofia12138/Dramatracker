import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';
import { getDb } from './db';
import { verifyToken, signToken, getTokenCookieOptions } from './jwt';
import type { JwtPayload } from './jwt';

export { signToken, verifyToken, getTokenCookieOptions };
export type { JwtPayload };

export interface AuthUser {
  id: number;
  username: string;
  name: string;
  role: string;
}

export type Permission =
  | 'view_dashboard'
  | 'view_ranking'
  | 'review_drama'
  | 'edit_drama'
  | 'export_data'
  | 'manage_play_count'
  | 'manage_data'
  | 'manage_users'
  | 'manage_settings'
  | 'use_ai';

const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  super_admin: [
    'view_dashboard', 'view_ranking', 'review_drama', 'edit_drama', 'export_data',
    'manage_play_count', 'manage_data', 'manage_users', 'manage_settings', 'use_ai',
  ],
  operation: ['view_dashboard', 'view_ranking', 'review_drama', 'edit_drama', 'export_data', 'manage_play_count', 'use_ai'],
  placement: ['view_dashboard', 'view_ranking', 'review_drama', 'edit_drama', 'export_data', 'manage_play_count'],
  production: ['view_dashboard', 'view_ranking'],
  screenwriter: ['view_dashboard', 'view_ranking', 'edit_drama'],
};

export function hasPermission(role: string, permission: Permission): boolean {
  const perms = ROLE_PERMISSIONS[role];
  return perms ? perms.includes(permission) : false;
}

export function hasAnyPermission(role: string, permissions: Permission[]): boolean {
  return permissions.some(p => hasPermission(role, p));
}

export function getRolePermissions(role: string): Permission[] {
  return ROLE_PERMISSIONS[role] || [];
}

export async function getAuthUserFromCookies(): Promise<AuthUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get('dt_token')?.value;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload) return null;
  return { id: payload.id, username: payload.username, name: payload.name, role: payload.role };
}

export async function getAuthUserFromRequest(request: NextRequest): Promise<AuthUser | null> {
  const token = request.cookies.get('dt_token')?.value;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload) return null;

  const db = getDb();
  const user = db.prepare('SELECT id, username, name, role, is_active FROM users WHERE id = ?').get(payload.id) as { id: number; username: string; name: string; role: string; is_active: number } | undefined;
  if (!user || !user.is_active) return null;

  return { id: user.id, username: user.username, name: user.name, role: user.role };
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
