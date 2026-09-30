import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { env } from "@/lib/env";
import { queryOne } from "@/lib/db";

const COOKIE_NAME = "swish_session";
const COOKIE_MAX_AGE = 60 * 60 * 8; // 8 hours
const secret = new TextEncoder().encode(env.JWT_SECRET);

export type SessionUser = {
  id: number;
  email: string;
  displayName: string;
  role: string;
  brandId: number | null;
  departmentId: number | null;
};

type DbUser = {
  id: number;
  email: string;
  password_hash: string;
  display_name: string;
  role: string;
  brand_id: number | null;
  department_id: number | null;
  is_active: boolean;
};

/** Verify email + password against the users table. */
export async function authenticate(
  email: string,
  password: string
): Promise<SessionUser | null> {
  const user = await queryOne<DbUser>(
    `SELECT TOP (1) id, email, password_hash, display_name, role, brand_id, department_id, is_active
     FROM users WHERE LOWER(email) = LOWER($1)`,
    [email]
  );
  if (!user || !user.is_active) return null;
  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) return null;
  await queryOne(`UPDATE users SET last_login_at = SYSUTCDATETIME() WHERE id = $1`, [user.id]);
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    role: user.role,
    brandId: user.brand_id,
    departmentId: user.department_id,
  };
}

export type ChangePasswordResult = "ok" | "wrong_current";

/** Self-service password change: verifies the current password first. */
export async function changeOwnPassword(
  userId: number,
  currentPassword: string,
  newPassword: string
): Promise<ChangePasswordResult> {
  const user = await queryOne<{ password_hash: string }>(
    `SELECT password_hash FROM users WHERE id = $1`,
    [userId]
  );
  if (!user || !bcrypt.compareSync(currentPassword, user.password_hash)) {
    return "wrong_current";
  }
  const hash = bcrypt.hashSync(newPassword, 10);
  await queryOne(`UPDATE users SET password_hash = $1 WHERE id = $2`, [hash, userId]);
  return "ok";
}

/** Sign a JWT and write it to an HTTP-only cookie. */
export async function createSession(user: SessionUser): Promise<void> {
  const token = await new SignJWT({ ...user })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("8h")
    .sign(secret);
  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
}

/** Read the cookie and return the current session, or null. */
export async function getSession(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    return {
      id: payload.id as number,
      email: payload.email as string,
      displayName: payload.displayName as string,
      role: payload.role as string,
      brandId: (payload.brandId as number | null) ?? null,
      departmentId: (payload.departmentId as number | null) ?? null,
    };
  } catch {
    return null;
  }
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
