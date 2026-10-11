import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 chars"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().optional(),
  // The session cookie is Secure (HTTPS-only) in production. Set this to
  // "false" only when the app is served over plain HTTP on a trusted
  // intranet; browsers silently drop a Secure cookie on http://, which
  // looks like "login succeeds but I'm sent back to the login page".
  SESSION_COOKIE_SECURE: z.enum(["true", "false"]).optional(),
  // SWiSH World single sign-on (src/app/api/sso/handoff/route.ts). The secret
  // must equal SSO_SECRET_COMPLIANCE in SWiSH World's .env; the source code is
  // the audience SWiSH World puts in the token (default COMPLIANCE); the base
  // URL is the public https origin used for redirects behind the IIS proxy.
  TASK_HUB_SSO_SECRET: z.string().optional(),
  TASK_HUB_SOURCE_CODE: z.string().optional(),
  APP_BASE_URL: z.string().optional(),
});

function parseEnv() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const env = parseEnv();
