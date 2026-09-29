/**
 * Lemon Squeezy webhook tests.
 *
 * WHY: this is the only code that writes `users.plan`, and it sits on the
 * public internet. Three things must never regress silently:
 *   1. signature verification (a bug here = anyone can upgrade themselves),
 *   2. the event → plan table (a bug here = paying users locked out, or
 *      expired users staying Pro),
 *   3. "verified but no change → 200" (a bug here = LS redelivers forever).
 *
 * SAFETY: no database. The store is a fake (BillingStore seam), so this file
 * runs anywhere — `bun test` with no DATABASE_URL.
 *
 * Run from the repo root:  bun test src/billing
 */
import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import {
  decidePlan,
  extractIds,
  handleLemonWebhook,
  resolveUserId,
  verifySignature,
  type BillingStore,
  type Payload,
  type PlanPatch,
} from "./webhook.ts";

/** A FAKE signing key — 40 hex chars, the shape Lemon Squeezy uses.
 *  NEVER paste the real LEMONSQUEEZY_WEBHOOK_SECRET here: this file is
 *  committed, and anyone with it can forge signed webhooks and grant
 *  themselves pro. Rotate via the LS dashboard if that ever happens. */
const SECRET = "0000000000000000000000000000000000000000";

const sign = (body: string, secret = SECRET) =>
  createHmac("sha256", secret).update(body).digest("hex");

/** Build a payload the way LS does: meta.event_name + data envelope. */
function payloadOf(
  eventName: string,
  overrides: {
    type?: string;
    id?: string | number;
    status?: string;
    user_email?: string;
    customer_id?: string | number;
    user_id?: string | number;
  } = {},
): Payload {
  const {
    type = eventName.startsWith("subscription") ? "subscriptions" : "orders",
    id = "9001",
    status,
    user_email,
    customer_id = "555",
    user_id,
  } = overrides;
  return {
    meta: {
      event_name: eventName,
      ...(user_id !== undefined ? { custom_data: { user_id } } : {}),
    },
    data: {
      type,
      id,
      attributes: {
        ...(status ? { status } : {}),
        ...(user_email ? { user_email } : {}),
        ...(customer_id !== undefined ? { customer_id } : {}),
      },
    },
  } as Payload;
}

function post(body: string, signature?: string | null): Request {
  return new Request("https://sepia.fly.dev/api/webhooks/lemonsqueezy", {
    method: "POST",
    headers: signature === undefined ? { "x-signature": sign(body) } : {},
    body,
  });
}

/** Fake store that records what was written. */
function fakeStore(opts: { knownId?: string | null } = {}): BillingStore & {
  writes: Array<{ userId: string; patch: PlanPatch }>;
  emailLookups: string[];
} {
  const knownId = opts.knownId ?? "user-1";
  const writes: Array<{ userId: string; patch: PlanPatch }> = [];
  const emailLookups: string[] = [];
  return {
    writes,
    emailLookups,
    async apply(userId, patch) {
      if (knownId === null || userId !== knownId) return false;
      writes.push({ userId, patch });
      return true;
    },
    async idByEmail(email) {
      emailLookups.push(email);
      return knownId;
    },
  };
}

const call = (body: string, store: BillingStore, signature?: string | null) =>
  handleLemonWebhook(post(body, signature), { store, secret: SECRET });

/** Parsed JSON of a handler response. Named `parsed`, not `body` — every test declares its own local `body` string. */
const parsed = (res: Response) =>
  res.json() as Promise<Record<string, unknown>>;

// ── Signature ──────────────────────────────────────────────────────────────

describe("verifySignature", () => {
  const body = JSON.stringify({ meta: { event_name: "subscription_created" } });

  test("accepts a correct HMAC-SHA256 hex digest", () => {
    expect(verifySignature(body, sign(body), SECRET)).toBe(true);
  });

  test("rejects a signature made with the wrong secret", () => {
    expect(verifySignature(body, sign(body, "wrong-secret"), SECRET)).toBe(
      false,
    );
  });

  test("rejects a tampered body", () => {
    const sig = sign(body);
    expect(verifySignature(body + " ", sig, SECRET)).toBe(false);
  });

  test("rejects a missing / empty signature", () => {
    expect(verifySignature(body, null, SECRET)).toBe(false);
    expect(verifySignature(body, "", SECRET)).toBe(false);
    expect(verifySignature(body, undefined, SECRET)).toBe(false);
  });

  test("rejects a non-hex signature of the same length", () => {
    expect(verifySignature(body, "z".repeat(64), SECRET)).toBe(false);
  });

  test("rejects a right-prefixed but extended signature", () => {
    const good = sign(body);
    expect(verifySignature(body, good + good, SECRET)).toBe(false);
  });
});

// ── Event → plan table ─────────────────────────────────────────────────────

describe("decidePlan", () => {
  test.each([
    ["order_created"],
    ["subscription_created"],
    ["subscription_payment_success"],
    ["subscription_resumed"],
  ])("%s → pro", (event) => {
    const d = decidePlan(event, payloadOf(event, { status: "active" }));
    expect(d.plan).toBe("pro");
  });

  test("subscription_expired → free", () => {
    const d = decidePlan(
      "subscription_expired",
      payloadOf("subscription_expired", { status: "expired" }),
    );
    expect(d.plan).toBe("free");
  });

  test.each([
    ["active"],
    ["on_trial"],
    ["paused"],
    ["past_due"],
    ["unpaid"],
    ["cancelled"], // grace period: still has access until ends_at
  ])("subscription_updated status=%s → pro", (status) => {
    const d = decidePlan(
      "subscription_updated",
      payloadOf("subscription_updated", { status }),
    );
    expect(d.plan).toBe("pro");
  });

  test("subscription_updated status=expired → free", () => {
    const d = decidePlan(
      "subscription_updated",
      payloadOf("subscription_updated", { status: "expired" }),
    );
    expect(d.plan).toBe("free");
  });

  test("subscription_updated with an unknown status is a logged no-op, not an upgrade", () => {
    const d = decidePlan(
      "subscription_updated",
      payloadOf("subscription_updated", { status: "quantum_superposed" }),
    );
    expect(d.plan).toBeUndefined();
    expect(d.reason).toContain("quantum_superposed");
  });

  test("subscription_updated with no status is a no-op", () => {
    const d = decidePlan(
      "subscription_updated",
      payloadOf("subscription_updated"),
    );
    expect(d.plan).toBeUndefined();
  });

  test.each([
    ["subscription_cancelled"], // never downgrade mid-grace
    ["subscription_payment_failed"], // dunning: don't cut off mid-retry
    ["subscription_paused"],
    ["order_refunded"],
    ["subscription_payment_refunded"],
    ["subscription_plan_changed"],
    ["subscription_payment_recovered"],
  ])("%s → no plan change", (event) => {
    const d = decidePlan(event, payloadOf(event, { status: "active" }));
    expect(d.plan).toBeUndefined();
  });

  test("an unrecognised event never grants pro", () => {
    const d = decidePlan(
      "affiliate_activated",
      payloadOf("affiliate_activated"),
    );
    expect(d.plan).toBeUndefined();
    expect(d.reason).toContain("unrecognised");
  });
});

// ── User resolution ────────────────────────────────────────────────────────

describe("resolveUserId", () => {
  test("prefers meta.custom_data.user_id", () => {
    expect(
      resolveUserId(payloadOf("subscription_created", { user_id: 42 })),
    ).toBe("42");
  });

  test("returns a string id as-is", () => {
    expect(
      resolveUserId(payloadOf("subscription_created", { user_id: "uuid-1" })),
    ).toBe("uuid-1");
  });

  test("absent custom data → undefined (caller falls back to email)", () => {
    expect(resolveUserId(payloadOf("subscription_created"))).toBeUndefined();
  });
});

describe("extractIds", () => {
  test("subscription events carry both handles", () => {
    const ids = extractIds(
      payloadOf("subscription_created", { id: "sub-1", customer_id: 77 }),
    );
    expect(ids).toEqual({
      lemonCustomerId: "77",
      lemonSubscriptionId: "sub-1",
    });
  });

  test("order events carry the customer but no subscription id", () => {
    const ids = extractIds(payloadOf("order_created", { type: "orders" }));
    expect(ids.lemonCustomerId).toBe("555");
    expect(ids.lemonSubscriptionId).toBeUndefined();
  });
});

// ── Handler ────────────────────────────────────────────────────────────────

describe("handleLemonWebhook", () => {
  test("401 on a bad signature — and writes nothing", async () => {
    const store = fakeStore();
    const res = await call(
      JSON.stringify({ meta: { event_name: "subscription_created" } }),
      store,
      "0".repeat(64),
    );
    expect(res.status).toBe(401);
    expect(store.writes).toHaveLength(0);
  });

  test("503 when no secret is configured (misconfiguration ≠ bypass)", async () => {
    const store = fakeStore();
    const res = await handleLemonWebhook(post("{}"), { store, secret: "" });
    expect(res.status).toBe(503);
    expect(store.writes).toHaveLength(0);
  });

  test("405 for non-POST is the route's job; handler itself reads any method", async () => {
    // The handler only cares about the body/signature — routing enforces POST.
    const body = JSON.stringify(
      payloadOf("subscription_created", { user_id: "user-1" }),
    );
    const store = fakeStore();
    const res = await handleLemonWebhook(post(body), { store, secret: SECRET });
    expect(res.status).toBe(200);
  });

  test("subscription_created with custom user_id → pro", async () => {
    const store = fakeStore();
    const body = JSON.stringify(
      payloadOf("subscription_created", {
        user_id: "user-1",
        status: "active",
        customer_id: 123,
      }),
    );
    const res = await call(body, store);
    expect(res.status).toBe(200);
    expect(await parsed(res)).toMatchObject({ applied: true, plan: "pro" });
    expect(store.writes).toEqual([
      {
        userId: "user-1",
        patch: {
          plan: "pro",
          lemonCustomerId: "123",
          lemonSubscriptionId: "9001",
        },
      },
    ]);
  });

  test("subscription_expired → free", async () => {
    const store = fakeStore();
    const body = JSON.stringify(
      payloadOf("subscription_expired", {
        user_id: "user-1",
        status: "expired",
      }),
    );
    const res = await call(body, store);
    expect(res.status).toBe(200);
    expect(store.writes[0]?.patch.plan).toBe("free");
  });

  test("falls back to email when custom data is absent", async () => {
    const store = fakeStore();
    const body = JSON.stringify(
      payloadOf("order_created", {
        type: "orders",
        user_email: "Buyer@Example.com",
      }),
    );
    const res = await call(body, store);
    expect(res.status).toBe(200);
    expect(store.emailLookups).toEqual(["buyer@example.com"]);
    expect(store.writes[0]?.userId).toBe("user-1");
  });

  test("an ignored event never changes the plan, even when it records ids", async () => {
    const store = fakeStore();
    const body = JSON.stringify(
      payloadOf("subscription_payment_failed", { user_id: "user-1" }),
    );
    const res = await call(body, store);
    expect(res.status).toBe(200);
    // Parse once — a Response body can only be consumed once.
    const out = await parsed(res);
    expect(out).toMatchObject({ applied: true }); // ids recorded…
    expect(out.plan ?? undefined).toBeUndefined(); // …plan untouched
  });

  test("verified event with nothing at all to write → 200 (no redelivery loop)", async () => {
    const store = fakeStore();
    const body = JSON.stringify({
      meta: { event_name: "affiliate_activated" },
      data: { type: "affiliates", id: "1", attributes: {} },
    });
    const res = await call(body, store);
    expect(res.status).toBe(200);
    expect(await parsed(res)).toMatchObject({ applied: false });
    expect(store.writes).toHaveLength(0);
  });

  test("unresolvable user → 200 + dropped, never 4xx (LS's data, not ours)", async () => {
    const store = fakeStore();
    const body = JSON.stringify(payloadOf("subscription_created")); // no id, no email
    const res = await call(body, store);
    expect(res.status).toBe(200);
    expect((await parsed(res)).reason).toBe("no_user");
    expect(store.writes).toHaveLength(0);
  });

  test("unknown user id → 200 + dropped", async () => {
    const store = fakeStore({ knownId: null }); // apply() always misses
    const body = JSON.stringify(
      payloadOf("subscription_created", { user_id: "ghost" }),
    );
    const res = await call(body, store);
    expect(res.status).toBe(200);
    expect((await parsed(res)).reason).toBe("user_missing");
  });

  test("422 on an unparseable payload", async () => {
    const store = fakeStore();
    const res = await call("{not json", store);
    expect(res.status).toBe(422);
    expect(store.writes).toHaveLength(0);
  });

  test("422 when the payload lacks meta.event_name", async () => {
    const store = fakeStore();
    const res = await call(JSON.stringify({ data: { type: "orders" } }), store);
    expect(res.status).toBe(422);
    expect(store.writes).toHaveLength(0);
  });

  test("tolerates unknown extra fields LS may add later", async () => {
    const store = fakeStore();
    const body = JSON.stringify({
      ...payloadOf("subscription_created", { user_id: "user-1" }),
      future_field: { anything: true },
    });
    const res = await call(body, store);
    expect(res.status).toBe(200);
    expect(store.writes[0]?.patch.plan).toBe("pro");
  });

  test("is idempotent — replaying the same event writes the same absolute value", async () => {
    const store = fakeStore();
    const body = JSON.stringify(
      payloadOf("subscription_created", {
        user_id: "user-1",
        status: "active",
      }),
    );
    await call(body, store);
    await call(body, store);
    expect(store.writes).toHaveLength(2);
    expect(store.writes[0]?.patch).toEqual(store.writes[1]?.patch);
    expect(store.writes[0]?.patch.plan).toBe("pro");
  });
});
