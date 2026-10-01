/**
 * AI-connection identity tests — `bindClientToUser()` / `findOwnedConnection()`.
 *
 * WHY THESE EXIST: the identity of an "AI connection" was once keyed on
 * `client_id`, which Dynamic Client Registration mints fresh on every
 * authorization (commit 2be9c32). That fix re-keyed it on the APP — the
 * `name@redirect-hostname` pair — to collapse re-registrations of one app.
 *
 * But app identity is not connection identity: it cannot tell one ACCOUNT of an
 * app from another. Two Grok logins are both `Grok@grok.com`, so binding the
 * second silently retired the first — revoking its tokens and deleting its row.
 * The user had two working Grok accounts and, after linking the second, one
 * working Grok account and a dead one they could not see any more.
 *
 * The discriminator is LIVENESS, and it has to be read per client:
 *   - A client whose client_id is already known is the SAME client re-authorizing.
 *     Reuse it. (LM Studio authorized 6x on one client_id in the live data.)
 *   - A DEAD previous connection (every refresh token revoked or expired) cannot
 *     work again, so retiring it loses nothing and is what keeps stale
 *     registrations from eating quota.
 *   - A LIVE previous connection is presumed to be a DIFFERENT account. Deleting
 *     a working connection is destructive and irreversible; keeping a row the
 *     user never asked for is not, and the quota already bounds the damage.
 *
 * SAFETY: same throwaway-owner pattern as briefing.test.ts — fixtures live under
 * `conn-suite+<run>@sepia.test` and cascade-delete in `afterAll`. The self-heal
 * only touches runs older than an hour and is scoped to this suite's own email
 * pattern. Without DATABASE_URL the whole file skips.
 *
 * Run from the repo root:  bun test
 */
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  test as bunTest,
} from "bun:test";
import { and, eq, inArray, like, lt } from "drizzle-orm";
import type { Db } from "../client.ts";
import { db } from "../client.ts";
import { oauthClients, oauthTokens, users } from "../schema.ts";
import {
  bindClientToUser,
  connectionIdentity,
  findOwnedConnection,
  isLocalClient,
} from "./oauth-clients.ts";

const hasDb = Boolean(process.env.DATABASE_URL);

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const SETUP_TIMEOUT_MS = 60_000;
const TEST_TIMEOUT_MS = 30_000;

const test = (
  name: string,
  fn: () => void | Promise<unknown>,
  timeout = TEST_TIMEOUT_MS,
) => bunTest(name, fn, timeout);

/** A URL-based Web AI client (Grok/ChatGPT style) — no DCR registration row. */
function webClient(clientId: string, name = "Grok") {
  return {
    client_id: clientId,
    client_name: name,
    redirect_uris: ["https://grok.com/connectors-oauth-exchange-code/"],
    token_endpoint_auth_method: "none",
  };
}

/** A loopback local editor (LM Studio style) — exempt from the connection quota. */
function editorClient(clientId: string) {
  return {
    client_id: clientId,
    client_name: "LM Studio",
    redirect_uris: ["http://127.0.0.1:33389/mcp-oauth-callback"],
    token_endpoint_auth_method: "none",
  };
}

describe.skipIf(!hasDb)("oauth client identity", () => {
  let conn: Db;

  /**
   * Each test gets its OWN owner. A shared owner would let one test's leftover
   * rows fail the next test's length assertion — and a loop that goes red for
   * the wrong reason teaches you nothing about the bug.
   */
  const emails: string[] = [];
  let ownerId = "";
  async function newOwner(label: string) {
    const email = `conn-suite+${label}-${RUN}@sepia.test`;
    emails.push(email);
    const [row] = await conn
      .insert(users)
      .values({ id: crypto.randomUUID(), name: "Conn Suite", email })
      .returning({ id: users.id });
    return String(row!.id);
  }

  /** The owner's client rows, oldest first. */
  const clients = async () =>
    conn.select().from(oauthClients).where(eq(oauthClients.ownerId, ownerId));

  const tokensFor = (clientId: string) =>
    conn.select().from(oauthTokens).where(eq(oauthTokens.clientId, clientId));

  /** Give `clientId` a live refresh token so it counts as a working connection. */
  async function seedLiveToken(clientId: string) {
    await conn.insert(oauthTokens).values({
      accessToken: `at-${clientId}`,
      refreshToken: `rt-${clientId}-${Math.random().toString(36).slice(2, 8)}`,
      clientId,
      scopes: [],
      userId: ownerId,
      expiresAt: new Date(Date.now() + 3_600_000),
      refreshExpiresAt: new Date(Date.now() + 30 * 86_400_000),
    });
  }

  beforeAll(async () => {
    conn = db();
    // Self-heal only long-dead runs; never another live run's fixtures.
    await conn
      .delete(users)
      .where(
        and(
          like(users.email, "conn-suite%@sepia.test"),
          lt(users.createdAt, new Date(Date.now() - 3_600_000)),
        ),
      );
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    // users cascade → oauth_clients → oauth_tokens
    if (emails.length > 0) {
      await conn.delete(users).where(inArray(users.email, emails));
    }
  });

  // ── Pure identity ─────────────────────────────────────────────────────────

  test("connectionIdentity ignores case, port and surrounding space", () => {
    const a = connectionIdentity("Grok", ["https://grok.com/cb/"]);
    const b = connectionIdentity("  grok ", ["https://GROK.com:443/cb/"]);
    expect(a).toBe(b);
    expect(a).toBe("grok@grok.com");
  });

  test("connectionIdentity keeps two hosts on the same app distinct", () => {
    expect(connectionIdentity("Grok", ["https://grok.com/a"])).not.toBe(
      connectionIdentity("ChatGPT", ["https://chatgpt.com/a"]),
    );
  });

  test("isLocalClient only accepts fully-loopback redirect sets", () => {
    expect(isLocalClient(["http://127.0.0.1:33389/cb"])).toBe(true);
    expect(isLocalClient(["http://localhost:9997/cb"])).toBe(true);
    expect(isLocalClient(["https://grok.com/cb"])).toBe(false);
    // One remote URI disqualifies the whole set.
    expect(
      isLocalClient(["http://127.0.0.1:1/cb", "https://evil.test/cb"]),
    ).toBe(false);
    expect(isLocalClient([])).toBe(false);
  });

  // ── The regression: a second account of the same app ─────────────────────

  test(
    "a second LIVE account of the same app survives",
    async () => {
      ownerId = await newOwner("second-live");
      const first = crypto.randomUUID();
      const second = crypto.randomUUID();

      await bindClientToUser(conn, webClient(first), ownerId);
      await seedLiveToken(first);

      // The user links their SECOND Grok account.
      await bindClientToUser(
        conn,
        webClient(second),
        ownerId,
        await findOwnedConnection(conn, ownerId, "Grok", [
          "https://grok.com/connectors-oauth-exchange-code/",
        ]),
      );
      await seedLiveToken(second);

      const rows = await clients();
      expect(rows).toHaveLength(2);
      // Both keep their tokens — neither connection was silently killed.
      expect((await tokensFor(first))[0]?.revokedAt ?? null).toBeNull();
      expect((await tokensFor(second))[0]?.revokedAt ?? null).toBeNull();
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "a DEAD same-app connection is still retired (stale registrations)",
    async () => {
      ownerId = await newOwner("dead-stale");
      const stale = crypto.randomUUID();
      const fresh = crypto.randomUUID();

      await bindClientToUser(conn, webClient(stale), ownerId);
      // A connection whose tokens are all gone cannot work again.
      await conn.insert(oauthTokens).values({
        accessToken: `at-${stale}`,
        refreshToken: `rt-${stale}-${Math.random().toString(36).slice(2, 8)}`,
        clientId: stale,
        scopes: [],
        userId: ownerId,
        expiresAt: new Date(Date.now() - 7_200_000),
        refreshExpiresAt: new Date(Date.now() - 3_600_000),
      });

      await bindClientToUser(
        conn,
        webClient(fresh),
        ownerId,
        await findOwnedConnection(conn, ownerId, "Grok", [
          "https://grok.com/connectors-oauth-exchange-code/",
        ]),
      );

      const rows = await clients();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.clientId).toBe(fresh);
      // Its token was revoked, as before.
      expect((await tokensFor(stale))[0]!.revokedAt).not.toBeNull();
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "re-authorizing on the SAME client_id never duplicates",
    async () => {
      ownerId = await newOwner("same-client-id");
      const clientId = crypto.randomUUID();

      await bindClientToUser(conn, webClient(clientId), ownerId);
      await bindClientToUser(
        conn,
        webClient(clientId),
        ownerId,
        await findOwnedConnection(conn, ownerId, "Grok", [
          "https://grok.com/connectors-oauth-exchange-code/",
        ]),
      );
      await bindClientToUser(
        conn,
        webClient(clientId),
        ownerId,
        await findOwnedConnection(conn, ownerId, "Grok", [
          "https://grok.com/connectors-oauth-exchange-code/",
        ]),
      );

      const rows = await clients();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.clientId).toBe(clientId);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "a re-registering local editor collapses to one row",
    async () => {
      // LM Studio re-registers on a new port each run — the case 2be9c32 fixed.
      // It is local, so the quota is exempt either way and collapsing is pure tidiness.
      ownerId = await newOwner("editor");
      const first = crypto.randomUUID();
      await bindClientToUser(conn, editorClient(first), ownerId);
      await seedLiveToken(first);

      const second = crypto.randomUUID();
      await bindClientToUser(
        conn,
        editorClient(second),
        ownerId,
        await findOwnedConnection(conn, ownerId, "LM Studio", [
          "http://127.0.0.1:33389/mcp-oauth-callback",
        ]),
      );

      const rows = await clients();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.clientId).toBe(second);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "different apps never collide",
    async () => {
      ownerId = await newOwner("two-apps");
      const grok = crypto.randomUUID();
      const chatgpt = crypto.randomUUID();
      await bindClientToUser(conn, webClient(grok), ownerId);
      await bindClientToUser(
        conn,
        {
          client_id: chatgpt,
          client_name: "ChatGPT",
          redirect_uris: [
            "https://chatgpt.com/connector_platform_oauth_redirect",
          ],
          token_endpoint_auth_method: "none",
        },
        ownerId,
        undefined,
      );
      const rows = await clients();
      expect(rows).toHaveLength(2);
    },
    TEST_TIMEOUT_MS,
  );
});
