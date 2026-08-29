/**
 * Authentication for /mcp and /api/* — multi-tenant accounts (Phase 3).
 *
 * Identity: Better Auth (email/password) with the apiKey + bearer plugins,
 * mounted in the same Bun.serve process at /api/auth/*. Every request
 * resolves to a USER; the business logic scopes all data by user id.
 *
 * Token resolution chain (first match wins):
 *   1. Legacy global MCP_BEARER_TOKEN  → the admin user (self-host compat)
 *   2. Better Auth session token       → its user (bearer plugin)
 *   3. Better Auth API key             → its user (local editors)
 *   4. OAuth 2.1 access token          → its user (web AIs)
 *
 * Modes:
 *   - Dev mode (no BETTER_AUTH_SECRET, no MCP_BEARER_TOKEN): no auth; a
 *     dev user is auto-created and used for every request.
 *   - Auth mode (BETTER_AUTH_SECRET set): auth enforced. ADMIN_EMAIL +
 *     ADMIN_PASSWORD are required at boot — the admin owns pre-tenant data
 *     (adopted by ensureAdmin).
 */

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { apiKey } from "@better-auth/api-key";
import { bearer } from "better-auth/plugins/bearer";
import { hashPassword } from "better-auth/crypto";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "./db.ts";
import {
  accounts,
  apikey,
  getUserByApiKey,
  getUserByEmail,
  getUserById,
  getUserBySessionToken,
  namespaces,
  oauthClients,
  oauthTokens,
  sessions,
  users,
  verifications,
  type UserRow,
} from "@sepia/shared";
import { oauth, oauthEnabled } from "./oauth.ts";
import { sendEmail } from "./lib/email.ts";

const TRUSTED_ORIGINS = [
  "https://sepia.svelte-apps.me",
  "http://localhost:5173",
  "http://localhost:4173",
];

const devMode =
  !process.env.BETTER_AUTH_SECRET && !process.env.MCP_BEARER_TOKEN;

export const auth = betterAuth({
  database: drizzleAdapter(db(), {
    provider: "pg",
    schema: {
      user: users,
      session: sessions,
      account: accounts,
      verification: verifications,
      // The apiKey plugin's model name is `apikey` (API_KEY_TABLE_NAME) —
      // the adapter resolves models by schema key.
      apikey,
    },
  }),
  // Dev fallback secret: sessions won't survive restarts — fine for dev.
  secret: process.env.BETTER_AUTH_SECRET ?? crypto.randomUUID(),
  baseURL:
    process.env.BETTER_AUTH_URL ??
    process.env.OAUTH_ISSUER_URL ??
    "https://sepia.fly.dev",
  emailAndPassword: {
    enabled: true,
    // Password reset via Resend. The URL points at the dashboard's
    // /reset-password page (token in the query string).
    sendResetPassword: async ({ user, url }) => {
      void sendEmail({
        to: user.email,
        subject: "Reset your Sepia password",
        text:
          `Someone requested a password reset for your Sepia account.\n\n` +
          `Click the link to choose a new password:\n${url}\n\n` +
          `If you didn't request this, you can safely ignore this email.`,
      });
    },
    // Reset = revoke all other sessions (stolen-token hygiene).
    revokeSessionsOnPasswordReset: true,
  },
  trustedOrigins: TRUSTED_ORIGINS,
  // Abuse-proofing: the free Resend tier is 100 emails/day, so the reset
  // endpoint is the attack surface. Tight per-IP limits on the email-sending
  // endpoints; sign-up/sign-in get their own caps. Memory storage is fine
  // for a single Fly VM (resets on cold start — acceptable).
  rateLimit: {
    enabled: true,
    window: 60,
    max: 30,
    customRules: {
      // 3 reset requests per hour per IP — a legit user needs ~1.
      "/request-password-reset": { window: 60 * 60, max: 3 },
      // 5 sign-ups per hour per IP — bounds fake-email spam.
      "/sign-up/email": { window: 60 * 60, max: 5 },
      // 10 sign-in attempts per minute per IP.
      "/sign-in/email": { window: 60, max: 10 },
    },
  },
  advanced: {
    // UUID ids — consistent with the rest of the schema.
    database: { generateId: () => crypto.randomUUID() },
    useSecureCookies: !devMode,
  },
  user: {
    additionalFields: {
      // Billing tier — set server-side only (manual assignment today,
      // billing webhooks later). Not user-editable.
      plan: { type: "string", defaultValue: "free", input: false },
    },
  },
  plugins: [apiKey(), bearer()],
});

export function authEnabled(): boolean {
  return Boolean(
    process.env.BETTER_AUTH_SECRET || process.env.MCP_BEARER_TOKEN,
  );
}

export type AuthResult = { user: UserRow } | Response;

function unauthorized(): Response {
  const wwwAuth = oauthEnabled()
    ? 'Bearer realm="sepia", resource_metadata="' +
      (process.env.OAUTH_ISSUER_URL ?? "https://sepia.fly.dev") +
      '/.well-known/oauth-protected-resource"'
    : 'Bearer realm="sepia"';
  return Response.json(
    { error: "unauthorized" },
    {
      status: 401,
      headers: { "WWW-Authenticate": wwwAuth },
    },
  );
}

/**
 * Resolve the authenticated user for a request, or return a 401 Response.
 * The returned user drives ALL data scoping downstream.
 */
export async function requireAuth(request: Request): Promise<AuthResult> {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  // Dev mode — no auth configured; every request acts as the dev user.
  if (devMode) {
    return { user: await ensureAdmin() };
  }

  if (token) {
    // 1. Legacy global token → admin (self-host backward compat).
    if (
      process.env.MCP_BEARER_TOKEN &&
      token === process.env.MCP_BEARER_TOKEN
    ) {
      return { user: await ensureAdmin() };
    }
    // 2. Better Auth session token (bearer plugin — dashboard).
    const sessionUser = await getUserBySessionToken(db(), token);
    if (sessionUser) return { user: sessionUser };
    // 3. Better Auth API key (local editors: Claude Code, Cursor, …).
    const keyUser = await getUserByApiKey(db(), token);
    if (keyUser) return { user: keyUser };
    // 4. OAuth 2.1 access token (web AIs).
    if (oauthEnabled()) {
      try {
        const info = await oauth.verify(request);
        const userId = info?.extra?.userId;
        if (typeof userId === "string") {
          const user = await getUserById(db(), userId);
          if (user) return { user };
        }
      } catch {
        // Not an OAuth token — fall through to 401.
      }
    }
  }
  return unauthorized();
}

let adminCache: UserRow | null = null;

/** Normalize a Better Auth user to the shared UserRow shape. */
function toUserRow(user: {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string | null;
  plan?: string;
  createdAt: Date;
  updatedAt: Date;
}): UserRow {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerified,
    image: user.image ?? null,
    plan: user.plan ?? "free",
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

/**
 * Bootstrap the admin account and adopt pre-tenant data. Called at boot and
 * lazily from requireAuth (dev mode). Idempotent.
 *
 * - ADMIN_EMAIL + ADMIN_PASSWORD set → create that user (plan: pro) if
 *   missing; they own the existing namespaces/clients/tokens.
 * - Dev mode (no secrets) → create dev@sepia.local.
 * - Auth mode without ADMIN_* → throw (fail loudly, never run ownerless).
 */
export async function ensureAdmin(): Promise<UserRow> {
  if (adminCache) return adminCache;
  const sql = db();
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  let admin: UserRow | undefined = email
    ? await getUserByEmail(sql, email)
    : undefined;
  if (!admin) {
    if (email && password) {
      const created = await auth.api.signUpEmail({
        body: { email, password, name: email.split("@")[0] ?? "admin" },
      });
      admin = toUserRow(created.user);
      console.log("[auth] bootstrap admin created:", admin.id, admin.email);
    } else if (devMode) {
      const created = await auth.api.signUpEmail({
        body: {
          email: "dev@sepia.local",
          password: "dev-password",
          name: "dev",
        },
      });
      admin = toUserRow(created.user);
    } else {
      throw new Error(
        "ADMIN_EMAIL and ADMIN_PASSWORD must be set (bootstrap admin for pre-tenant data)",
      );
    }
  }

  // The admin always runs on Pro (they own the pre-tenant data and are the
  // operator). Idempotent — safe to run on every boot.
  await sql.update(users).set({ plan: "pro" }).where(eq(users.id, admin.id));

  // Repair: if the admin user exists but has no credential account (e.g. a
  // signUpEmail that created the user but failed before the account insert),
  // link the credential account so sign-in works.
  const cred = await sql
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(eq(accounts.userId, admin.id), eq(accounts.providerId, "credential")),
    )
    .limit(1);
  if (!cred[0] && password) {
    const passwordHash = await hashPassword(password);
    await sql.insert(accounts).values({
      id: crypto.randomUUID(),
      userId: admin.id,
      accountId: admin.id,
      providerId: "credential",
      // Better Auth's local credential issuer — sign-in matches on this.
      issuer: "local:credential",
      password: passwordHash,
    });
    console.log("[auth] bootstrap admin credential account linked");
  }

  // Adopt orphaned pre-tenant rows (owner_id/user_id were NULL before 0006).
  await sql
    .update(namespaces)
    .set({ ownerId: admin.id })
    .where(isNull(namespaces.ownerId));
  await sql
    .update(oauthClients)
    .set({ ownerId: admin.id })
    .where(isNull(oauthClients.ownerId));
  await sql
    .update(oauthTokens)
    .set({ userId: admin.id })
    .where(isNull(oauthTokens.userId));

  adminCache = admin;
  return admin;
}

/** Verify email/password against Better Auth (OAuth login page). */
export async function verifyCredentials(
  email: string,
  password: string,
): Promise<UserRow | null> {
  try {
    const result = await auth.api.signInEmail({
      body: { email, password },
    });
    return result.user ? toUserRow(result.user) : null;
  } catch {
    return null;
  }
}
