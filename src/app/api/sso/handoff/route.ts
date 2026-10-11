/**
 * SWiSH World single sign-on handoff — Swish Compliance
 * =====================================================
 * SWiSH World (world.swishhh.net) opens this app through
 *
 *     GET /api/sso/handoff?token=<60-second JWT>
 *
 * The token is signed with the shared secret (HS256, issuer "swish-task-hub",
 * audience "COMPLIANCE") and carries the person's e-mail. We match it to a row
 * in dbo.users, mint the normal `swish_session` cookie (same claims, same
 * attributes as the password login in src/lib/auth/session.ts) and redirect to
 * the requested page — the same effect as logging in, without the login form.
 *
 * Configuration (.env.local)
 *   TASK_HUB_SSO_SECRET   same value as SSO_SECRET_COMPLIANCE in SWiSH World's .env
 *   TASK_HUB_SOURCE_CODE  audience in the token (default COMPLIANCE)
 *   APP_BASE_URL          public https origin (https://compliance.swishhh.net);
 *                         IIS ARR rewrites to 127.0.0.1:6011 so req.url's host
 *                         cannot be used for redirects or the same-host check.
 *
 * The path is listed in PUBLIC_PATHS of src/middleware.ts so the edge
 * middleware lets the unauthenticated request through.
 *
 * Security notes
 *   - jose.jwtVerify with algorithms pinned to HS256, issuer + audience checked,
 *     exp enforced (jose refuses expired tokens by default).
 *   - The role in the token is never used; the role always comes from users.role.
 *   - Accounts are never created here (role/department must be chosen by IT).
 *   - returnUrl is honoured only on this app's own host and never for /login
 *     or /api/*; everything else lands on /my-work.
 *   - The token is never logged.
 */

import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify, type JWTPayload } from "jose";
import { env } from "@/lib/env";
import { execute, queryAll, queryOne } from "@/lib/db";
import {
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
  signSessionToken,
  type SessionUser,
} from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_PUBLIC_ORIGIN = "https://compliance.swishhh.net";
const HOME_PATH = "/my-work";
const LOGIN_PATH = "/login";
const TOKEN_ISSUER = "swish-task-hub";
/** Roles a hub identity mapping may never point at. */
const ADMIN_ROLES = new Set(["admin"]);

type HandoffClaims = JWTPayload & {
  email?: unknown;
  name?: unknown;
  role?: unknown;
  returnUrl?: unknown;
  /** Optional: the Compliance login / id SWiSH World mapped to this person (Settings -> Identity mapping). */
  sourceUsername?: unknown;
  sourceUserId?: unknown;
};

type DbUser = {
  id: number;
  email: string;
  display_name: string;
  role: string;
  brand_id: number | null;
  department_id: number | null;
  is_active: boolean;
};

const USER_COLUMNS =
  "id, email, display_name, role, brand_id, department_id, is_active";

function sharedSecret(): string {
  return (env.TASK_HUB_SSO_SECRET ?? process.env.TASK_HUB_SSO_SECRET ?? "").trim();
}

function sourceCode(): string {
  return (env.TASK_HUB_SOURCE_CODE ?? "COMPLIANCE").trim() || "COMPLIANCE";
}

function headerHost(req: NextRequest, name: string): string | null {
  const value = req.headers.get(name);
  if (!value) return null;
  const first = value.split(",")[0]?.trim().toLowerCase();
  return first || null;
}

/**
 * The origin the browser actually uses. Behind IIS ARR req.url is
 * http://127.0.0.1:6011, so prefer APP_BASE_URL, then the forwarded headers,
 * and only then the request URL itself (plain `next dev`).
 */
function publicOrigin(req: NextRequest): string {
  const configured = (env.APP_BASE_URL ?? "").trim();
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      /* fall through */
    }
  }
  const forwardedHost = headerHost(req, "x-forwarded-host");
  if (forwardedHost) {
    const proto = headerHost(req, "x-forwarded-proto") ?? "https";
    return `${proto}://${forwardedHost}`;
  }
  try {
    const origin = req.nextUrl.origin;
    if (!/^https?:\/\/(127\.0\.0\.1|0\.0\.0\.0)(:|$)/i.test(origin)) return origin;
  } catch {
    /* ignore */
  }
  return DEFAULT_PUBLIC_ORIGIN;
}

/** Hosts this Compliance instance answers on: request host, IIS-forwarded host, APP_BASE_URL. */
function ownHosts(req: NextRequest): Set<string> {
  const hosts = new Set<string>();
  for (const name of ["x-forwarded-host", "host"]) {
    const value = headerHost(req, name);
    if (value) hosts.add(value);
  }
  try {
    hosts.add(new URL(publicOrigin(req)).host.toLowerCase());
  } catch {
    /* ignore */
  }
  try {
    hosts.add(new URL(DEFAULT_PUBLIC_ORIGIN).host);
  } catch {
    /* ignore */
  }
  return hosts;
}

/**
 * Where to land. Only paths on this app's own hosts are accepted; the login
 * page and API routes are replaced by the home page; anything else falls back
 * to /my-work so a token can never redirect to a foreign site.
 */
function landingPath(req: NextRequest, returnUrl: unknown): string {
  if (typeof returnUrl !== "string" || !returnUrl.trim()) return HOME_PATH;
  try {
    const url = new URL(returnUrl, publicOrigin(req));
    if (!ownHosts(req).has(url.host.toLowerCase())) return HOME_PATH;
    if (/^\/(login|api)(\/|$)/i.test(url.pathname)) return HOME_PATH;
    const path = `${url.pathname}${url.search}${url.hash}`;
    return path.startsWith("/") && !path.startsWith("//") ? path : HOME_PATH;
  } catch {
    return HOME_PATH;
  }
}

function plain(status: number, message: string): NextResponse {
  return new NextResponse(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** Back to the normal login page with a short reason the page can show. */
function toLogin(req: NextRequest, reason: string, email: string): NextResponse {
  const url = new URL(LOGIN_PATH, publicOrigin(req));
  url.searchParams.set("sso", reason);
  if (email) url.searchParams.set("email", email);
  const res = NextResponse.redirect(url, 302);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

async function usersByEmail(email: string): Promise<DbUser[]> {
  return queryAll<DbUser>(
    `SELECT TOP (2) ${USER_COLUMNS} FROM users WHERE LOWER(email) = LOWER($1)`,
    [email]
  );
}

async function userById(id: number): Promise<DbUser | undefined> {
  return queryOne<DbUser>(
    `SELECT TOP (1) ${USER_COLUMNS} FROM users WHERE id = $1`,
    [id]
  );
}

export async function GET(req: NextRequest) {
  const secret = sharedSecret();
  if (secret.length < 32) {
    return plain(
      500,
      "TASK_HUB_SSO_SECRET is not configured on Compliance (it must be the 64-character value from SWiSH World and at least 32 characters long). Ask IT."
    );
  }

  const token = req.nextUrl.searchParams.get("token") ?? "";
  let claims: HandoffClaims;
  try {
    if (!token) throw new Error("missing token");
    const verified = await jwtVerify(token, new TextEncoder().encode(secret), {
      algorithms: ["HS256"],
      issuer: TOKEN_ISSUER,
      audience: sourceCode(),
    });
    claims = verified.payload as HandoffClaims;
  } catch {
    return plain(
      401,
      "This SWiSH World sign-in link is invalid or has expired (links last 60 seconds). Go back to SWiSH World and open Compliance again."
    );
  }

  const email = String(claims.email ?? "").trim().toLowerCase();
  if (!email) {
    return plain(401, "The SWiSH World sign-in token did not include an e-mail address.");
  }

  // 1) e-mail (the e-mail IS the login in this app, so "username == e-mail" is
  //    the same lookup), 2) the login SWiSH World mapped to this person,
  //    3) the mapped user id.
  let user: DbUser | undefined;
  const byEmail = await usersByEmail(email);
  const activeByEmail = byEmail.filter((u) => u.is_active);
  if (activeByEmail.length > 1) {
    return toLogin(req, "ambiguous", email);
  }
  user = activeByEmail[0] ?? byEmail[0];

  if (!user) {
    const mappedLogin = String(claims.sourceUsername ?? "").trim();
    if (mappedLogin) {
      const rows = await usersByEmail(mappedLogin);
      const active = rows.filter((u) => u.is_active);
      if (active.length > 1) return toLogin(req, "ambiguous", email);
      user = active[0] ?? rows[0];
    }
    const mappedId = String(claims.sourceUserId ?? "").trim();
    if (!user && /^\d{1,9}$/.test(mappedId)) {
      user = await userById(Number(mappedId));
    }
    // A mapping may only point at an account whose own e-mail is blank or the
    // same one, and never at an administrator — a hub admin cannot map
    // themselves into someone else's Compliance account.
    if (user) {
      const ownEmail = String(user.email ?? "").trim().toLowerCase();
      const isAdmin = ADMIN_ROLES.has(String(user.role ?? "").toLowerCase());
      if ((ownEmail && ownEmail !== email) || isAdmin) {
        return toLogin(req, "mapping-refused", email);
      }
    }
  }

  if (!user) return toLogin(req, "no-user", email);
  if (!user.is_active) return toLogin(req, "disabled", email);

  // Role, brand and department always come from the app's own user row —
  // the token's role claim is informational only.
  const sessionUser: SessionUser = {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    role: user.role,
    brandId: user.brand_id,
    departmentId: user.department_id,
  };
  const sessionToken = await signSessionToken(sessionUser);

  try {
    await execute(`UPDATE users SET last_login_at = SYSUTCDATETIME() WHERE id = $1`, [user.id]);
    await execute(
      `INSERT INTO audit_logs (user_id, user_email, action, entity, details)
       VALUES ($1, $2, 'sso_login', 'auth', $3)`,
      [user.id, user.email, JSON.stringify({ role: user.role, via: "swish-world" })]
    );
  } catch (error) {
    console.warn(
      "[sso] could not record the sign-in:",
      error instanceof Error ? error.message : error
    );
  }

  const target = new URL(landingPath(req, claims.returnUrl), publicOrigin(req));
  const res = NextResponse.redirect(target, 302);
  res.cookies.set(SESSION_COOKIE_NAME, sessionToken, sessionCookieOptions());
  res.headers.set("Cache-Control", "no-store, private");
  res.headers.set("Referrer-Policy", "no-referrer");
  return res;
}
