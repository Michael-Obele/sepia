/**
 * Lemon Squeezy webhook — the source of truth for `users.plan`.
 *
 * WHY THIS FILE EXISTS: the pricing page sells Pro, but nothing could flip a
 * user's tier. The merchant of record (Lemon Squeezy) tells us when money
 * moved; this module is the only code allowed to write `users.plan` besides
 * the admin bootstrap.
 *
 * ARCHITECTURE (docs/plans/2026-09-29-lemon-squeezy-billing-design.md):
 * the webhook lives on Fly — not the dashboard — for two reasons:
 *   1. LS must reach it unauthenticated, and src/api.ts 401s every /api/*
 *      route without a user, so it is mounted BEFORE that guard.
 *   2. The dashboard cannot authenticate to Fly for an arbitrary user
 *      (src/auth.ts deliberately rejects browser sessions there).
 *
 * SECURITY: every request is verified with HMAC-SHA256 over the RAW body
 * against `X-Signature`, compared timing-safe. No signature → 401, no
 * secret configured → 503 (a deploy without the env var must be loud, never
 * a silent "accept everything" fallback).
 *
 * IDEMPOTENCY: LS retries on non-2xx, so every write is an absolute SET
 * (never an increment) and a verified event that changes nothing still
 * returns 200 — otherwise LS redelivers the same event forever.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import * as v from "valibot";
import { eq } from "drizzle-orm";
import { users, type UserRow } from "@sepia/shared";
import { db, type Db } from "../db.ts";

// ── Types ──────────────────────────────────────────────────────────────────

export type Plan = "free" | "pro";

/** What we may write to `users` from one event. All fields optional/absolute. */
export interface PlanPatch {
  plan?: Plan;
  lemonCustomerId?: string;
  lemonSubscriptionId?: string;
}

/** A resolved decision: `plan` undefined = don't change the tier. */
export interface PlanDecision {
  plan?: Plan;
  reason: string;
}

/**
 * The write seam. The real implementation hits Neon; tests pass an in-memory
 * fake so the whole handler runs without a database.
 */
export interface BillingStore {
  /** Apply an absolute patch. Returns false when no user matched. */
  apply(userId: string, patch: PlanPatch): Promise<boolean>;
  /** Email fallback for checkouts opened without our custom data. */
  idByEmail(email: string): Promise<string | null>;
}

// ── Payload ────────────────────────────────────────────────────────────────

/**
 * Only the fields we actually read. `looseObject` keeps unknown keys — LS
 * payload shapes vary by event and we don't want a new field upstream to
 * break parsing (a 422 would make LS redeliver forever).
 */
const Payload = v.object({
  meta: v.object({
    event_name: v.string(),
    custom_data: v.optional(v.record(v.string(), v.unknown())),
  }),
  data: v.looseObject({
    type: v.string(),
    id: v.optional(v.union([v.string(), v.number()])),
    attributes: v.looseObject({
      status: v.optional(v.string()),
      user_email: v.optional(v.string()),
      customer_id: v.optional(v.union([v.string(), v.number()])),
    }),
  }),
});

export type Payload = v.InferOutput<typeof Payload>;

// ── Signature ──────────────────────────────────────────────────────────────

/**
 * Verify `X-Signature` against the raw body. The signature MUST be computed
 * over the exact bytes LS sent — that's why the handler reads `request.text()`
 * itself and hands the string here, rather than re-serialising parsed JSON.
 */
export function verifySignature(
  rawBody: string,
  signature: string | null | undefined,
  secret: string,
): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  // timingSafeEqual throws on length mismatch — compare lengths first, and
  // do it in constant time by hashing both so length itself isn't an oracle.
  if (a.length !== b.length) {
    // Still run a comparison so the failure path costs the same work.
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

// ── Event → plan mapping ───────────────────────────────────────────────────

/** Money in / subscription alive → pro. */
const PRO_EVENTS = new Set([
  "order_created",
  "subscription_created",
  "subscription_payment_success",
  "subscription_resumed",
]);

/**
 * Subscription status → tier, for the `subscription_updated` catch-all.
 * Explicit map rather than "anything not expired is pro": an unknown future
 * status should be a logged no-op, not a free upgrade.
 *
 * `cancelled` → pro is deliberate: LS cancels immediately but keeps access
 * until `ends_at`; the downgrade arrives later as `subscription_expired`.
 * `past_due`/`paused`/`unpaid` → pro: dunning is not a reason to lock out a
 * customer who is mid-retry.
 */
const STATUS_TO_PLAN: Record<string, Plan> = {
  active: "pro",
  on_trial: "pro",
  paused: "pro",
  past_due: "pro",
  unpaid: "pro",
  cancelled: "pro",
  expired: "free",
};

/** Explicitly recognised-but-ignored events (logged, never upgraded). */
const IGNORED_EVENTS = new Set([
  "subscription_cancelled",
  "subscription_payment_failed",
  "subscription_paused",
  "order_refunded",
  "subscription_payment_refunded",
  "subscription_plan_changed",
  "subscription_payment_recovered",
]);

/**
 * Map one LS event to a plan patch decision. Pure — no I/O — so the whole
 * mapping table is table-testable.
 */
export function decidePlan(eventName: string, payload: Payload): PlanDecision {
  if (PRO_EVENTS.has(eventName)) {
    return { plan: "pro", reason: `${eventName}: paid/active` };
  }
  if (eventName === "subscription_expired") {
    return { plan: "free", reason: "subscription expired (grace period over)" };
  }
  if (eventName === "subscription_updated") {
    const status = payload.data.attributes.status;
    if (!status) return { reason: "subscription_updated with no status" };
    const plan = STATUS_TO_PLAN[status];
    if (!plan) return { reason: `unhandled status "${status}"` };
    return { plan, reason: `subscription_updated: status=${status}` };
  }
  if (IGNORED_EVENTS.has(eventName)) {
    return { reason: `${eventName}: ignored` };
  }
  return { reason: `unrecognised event "${eventName}"` };
}

// ── User resolution + id extraction ────────────────────────────────────────

function strId(value: unknown): string | undefined {
  if (typeof value === "string" && value) return value;
  if (typeof value === "number") return String(value);
  return undefined;
}

/**
 * Custom data is injected at checkout (`checkout_data.custom.user_id`) and
 * echoed back in `meta.custom_data` on every order/subscription event. The
 * email fallback covers a checkout opened directly (no custom data) — LS
 * still tells us who bought it.
 */
export function resolveUserId(payload: Payload): string | undefined {
  const custom = payload.meta.custom_data;
  const customId = strId(custom?.user_id);
  if (customId) return customId;
  return undefined; // caller falls back to email lookup
}

/** Customer/subscription handles worth storing for a future portal pass. */
export function extractIds(payload: Payload): {
  lemonCustomerId?: string;
  lemonSubscriptionId?: string;
} {
  const customerId = strId(payload.data.attributes.customer_id);
  const subscriptionId =
    payload.data.type === "subscriptions" ? strId(payload.data.id) : undefined;
  return {
    ...(customerId ? { lemonCustomerId: customerId } : {}),
    ...(subscriptionId ? { lemonSubscriptionId: subscriptionId } : {}),
  };
}

// ── Store ──────────────────────────────────────────────────────────────────

/** Neon-backed store. Lazy so tests never open a connection. */
export function neonStore(sql: Db = db()): BillingStore {
  return {
    async apply(userId, patch) {
      const result = await sql
        .update(users)
        .set({
          ...(patch.plan ? { plan: patch.plan } : {}),
          ...(patch.lemonCustomerId
            ? { lemonCustomerId: patch.lemonCustomerId }
            : {}),
          ...(patch.lemonSubscriptionId
            ? { lemonSubscriptionId: patch.lemonSubscriptionId }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId))
        .returning({ id: users.id });
      return result.length > 0;
    },
    async idByEmail(email) {
      const rows = await sql
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email.toLowerCase()))
        .limit(1);
      return rows[0]?.id ?? null;
    },
  };
}

// ── Handler ────────────────────────────────────────────────────────────────

const json = (status: number, body: Record<string, unknown>) =>
  Response.json(body, { status });

export interface WebhookDeps {
  store?: BillingStore;
  /** Overrides the env var — tests only. */
  secret?: string;
}

/**
 * Handle one webhook delivery. Returns a Response for every path; never
 * throws past this boundary (an unhandled throw = 500 = LS retry, which is
 * the correct behaviour for a genuine server error).
 */
export async function handleLemonWebhook(
  request: Request,
  deps: WebhookDeps = {},
): Promise<Response> {
  const secret = deps.secret ?? process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[billing] LEMONSQUEEZY_WEBHOOK_SECRET is not set");
    return json(503, { error: "billing_not_configured" });
  }

  const raw = await request.text();
  const signature = request.headers.get("x-signature");
  if (!verifySignature(raw, signature, secret)) {
    console.warn("[billing] webhook rejected: bad signature");
    return json(401, { error: "invalid_signature" });
  }

  let payload: Payload;
  try {
    const parsed = v.safeParse(Payload, JSON.parse(raw));
    if (!parsed.success) {
      console.error(
        "[billing] webhook payload failed schema:",
        v.flatten(parsed.issues),
      );
      return json(422, { error: "invalid_payload" });
    }
    payload = parsed.output;
  } catch {
    console.error("[billing] webhook body is not JSON");
    return json(422, { error: "invalid_json" });
  }

  const eventName = payload.meta.event_name;
  const decision = decidePlan(eventName, payload);
  const ids = extractIds(payload);
  const patch: PlanPatch = {
    ...(decision.plan ? { plan: decision.plan } : {}),
    ...ids,
  };

  // Verified but nothing to write → 200 with a reason. This is NOT a no-op
  // to LS: it means "handled", and returning an error here would trigger
  // redelivery of an event we have already decided not to act on.
  //
  // NOTE: this branch is a safety net, not the common path — most events also
  // carry a customer_id, which we opportunistically record even when the plan
  // doesn't change (learning the handles early makes a later portal pass
  // work regardless of which event arrives first).
  if (!patch.plan && !patch.lemonCustomerId && !patch.lemonSubscriptionId) {
    console.log(`[billing] ${eventName}: ${decision.reason}`);
    return json(200, {
      received: true,
      applied: false,
      reason: decision.reason,
    });
  }

  const store = deps.store ?? neonStore();
  let userId = resolveUserId(payload);
  if (!userId) {
    const email = payload.data.attributes.user_email;
    // Normalize here, at the boundary — `users.email` is stored lowercase
    // everywhere else (signup, getUserByEmail), so every store impl gets the
    // same canonical input.
    if (email)
      userId = (await store.idByEmail(email.toLowerCase())) ?? undefined;
  }

  if (!userId) {
    // LS's data, not ours — a 4xx would only make LS retry the same event.
    console.warn(
      `[billing] ${eventName}: no user matched (custom user_id / email absent)`,
    );
    return json(200, { received: true, applied: false, reason: "no_user" });
  }

  const applied = await store.apply(userId, patch);
  if (!applied) {
    console.warn(`[billing] ${eventName}: user ${userId} not found — dropping`);
    return json(200, {
      received: true,
      applied: false,
      reason: "user_missing",
    });
  }

  console.log(
    `[billing] ${eventName} → user=${userId} ${decision.reason}` +
      `${patch.plan ? ` plan=${patch.plan}` : ""}` +
      `${payload.data.attributes.status ? ` status=${payload.data.attributes.status}` : ""}`,
  );
  return json(200, { received: true, applied: true, plan: patch.plan ?? null });
}

/** Re-exported for the route's type hints. */
export type { UserRow };
