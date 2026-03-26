import { SignJWT, jwtVerify } from 'jose';

const JWT_SECRET = process.env.JWT_SECRET || 'dramatracker_jwt_secret_key_2024';
const TOKEN_MAX_AGE = 7 * 24 * 60 * 60;

export interface JwtPayload {
  id: number;
  username: string;
  name: string;
  role: string;
  iat?: number;
  exp?: number;
}

function getSecretKey() {
  return new TextEncoder().encode(JWT_SECRET);
}

export async function signToken(user: { id: number; username: string; name: string; role: string }): Promise<string> {
  return new SignJWT({ id: user.id, username: user.username, name: user.name, role: user.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_MAX_AGE}s`)
    .sign(getSecretKey());
}

export async function verifyToken(token: string): Promise<JwtPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    return payload as unknown as JwtPayload;
  } catch {
    return null;
  }
}

export function getTokenCookieOptions() {
  return {
    name: 'dt_token' as const,
    httpOnly: true,
    secure: false,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: TOKEN_MAX_AGE,
  };
}
