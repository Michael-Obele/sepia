/**
 * Cross-account redaction on the write path.
 *
 * THE INCIDENT. A multi-account operator ran a migration dry run and saved the
 * report as ordinary memories. The report contained a second real user's email
 * and per-project counts. Every read path is owner-scoped — the probe in
 * `scripts/tenant-isolation-probe.ts` confirms a non-owner gets zero hits — so
 * this was never a tenant breach, but a user's identifiers sat in another
 * account's searchable prose, and nothing on the write path objected.
 *
 * These tests are the objection. They seed two real owners and assert the
 * boundary in both directions:
 *   - a FOREIGN ACCOUNT's address never reaches a stored row;
 *   - a legtimately stored address — the writer's own, or a contact who is not
 *     an account here — is left exactly as written.
 *
 * That second half is the whole point. A redactor that mangles every address
 * would make the store useless for the thing people store: contact details.
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
import { memories, namespaces, users } from "../schema.ts";
import { entities } from "../schema.ts";
import { createMemory, queryMemories, updateMemory } from "./memories.ts";
import { ingestConversation } from "./conversations.ts";
import { createEntity } from "./entities.ts";
import {
  FOREIGN_ACCOUNT_MASK,
  applyAccountRedactions,
  extractEmails,
} from "./redact.ts";

const hasDb = Boolean(process.env.DATABASE_URL);
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** The operator writing the memory. */
const WRITER_EMAIL = `redact-writer+${RUN}@sepia.test`;
/** The other real account whose address must not land in the writer's rows. */
const VICTIM_EMAIL = `redact-victim+${RUN}@sepia.test`;
/** Not an account here — a contact. Must survive verbatim. */
const CONTACT_EMAIL = `someone-else+${RUN}@example.org`;
const NS = "redact-suite";
const SETUP_TIMEOUT_MS = 60_000;
const TEST_TIMEOUT_MS = 30_000;

const test = (name: string, fn: () => void | Promise<unknown>) =>
  bunTest(name, fn, TEST_TIMEOUT_MS);

describe.skipIf(!hasDb)("cross-account redaction", () => {
  let conn: Db;
  let writerId = "";
  let nsId = "";

  beforeAll(async () => {
    conn = db();

    // Self-heal only long-dead runs, never another live run's fixtures.
    await conn
      .delete(users)
      .where(
        and(
          like(users.email, "redact-%@sepia.test"),
          lt(users.createdAt, new Date(Date.now() - 3_600_000)),
        ),
      );

    const seeded = await conn
      .insert(users)
      .values([
        { id: crypto.randomUUID(), name: "Writer", email: WRITER_EMAIL },
        { id: crypto.randomUUID(), name: "Victim", email: VICTIM_EMAIL },
      ])
      .returning({ id: users.id, email: users.email });
    writerId = String(seeded.find((u) => u.email === WRITER_EMAIL)!.id);

    const [ns] = await conn
      .insert(namespaces)
      .values({ ownerId: writerId, name: NS, description: "test" })
      .returning({ id: namespaces.id });
    nsId = String(ns!.id);
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    if (!conn) return;
    await conn
      .delete(users)
      .where(inArray(users.email, [WRITER_EMAIL, VICTIM_EMAIL]));
  }, SETUP_TIMEOUT_MS);

  /** Read a stored row's content straight from the table, bypassing any helper. */
  async function stored(id: string): Promise<string> {
    const [row] = await conn
      .select({ content: memories.content })
      .from(memories)
      .where(and(eq(memories.id as never, id)))
      .limit(1);
    return String(row?.content ?? "");
  }

  // ── Pure helpers ─────────────────────────────────────────────────────────
  test("extractEmails finds, lowercases and de-duplicates", () => {
    expect(extractEmails(`a@B.com and a@b.com plus c@d.io`)).toEqual([
      "a@b.com",
      "c@d.io",
    ]);
    expect(extractEmails("no addresses here")).toEqual([]);
  });

  test("masking is literal and case-insensitive, not a substring smash", () => {
    // The longer address is its own candidate, so the shorter one must not
    // partly replace it.
    expect(applyAccountRedactions("mail a@b.com now", ["a@b.com"])).toBe(
      `mail ${FOREIGN_ACCOUNT_MASK} now`,
    );
    expect(applyAccountRedactions("mail A@B.COM now", ["a@b.com"])).toBe(
      `mail ${FOREIGN_ACCOUNT_MASK} now`,
    );
    expect(applyAccountRedactions("nothing to do", ["a@b.com"])).toBe(
      "nothing to do",
    );
  });

  // ── The boundary, through the real write path ───────────────────────────
  test("a foreign account's address never reaches a stored memory", async () => {
    const created = await createMemory(
      conn,
      writerId,
      {
        content: `Operator report: the other user is ${VICTIM_EMAIL} with 187 memories.`,
        namespace: NS,
        type: "fact",
      },
      "test",
    );
    expect(created).toBeDefined();
    // The response says so rather than masking silently.
    expect(created?.redacted_accounts).toBe(1);

    const text = await stored(String(created!.id));
    expect(text).not.toContain(VICTIM_EMAIL);
    expect(text).toContain(FOREIGN_ACCOUNT_MASK);
    // The engineering finding survives — only the identifier goes.
    expect(text).toContain("187 memories");
  });

  test("the writer's own address and a contact survive verbatim", async () => {
    const content = `My login is ${WRITER_EMAIL}; the vendor contact is ${CONTACT_EMAIL}.`;
    const created = await createMemory(
      conn,
      writerId,
      { content, namespace: NS, type: "fact" },
      "test",
    );
    expect(created).toBeDefined();
    // Nothing was foreign, so nothing is reported.
    expect(created?.redacted_accounts).toBeUndefined();
    expect(await stored(String(created!.id))).toBe(content);
  });

  test("an update cannot smuggle one in either", async () => {
    const created = await createMemory(
      conn,
      writerId,
      { content: "clean starting point", namespace: NS, type: "fact" },
      "test",
    );
    const id = String(created!.id);
    await updateMemory(conn, writerId, id, {
      content: `now mentions ${VICTIM_EMAIL}`,
    });
    const text = await stored(id);
    expect(text).not.toContain(VICTIM_EMAIL);
    expect(text).toContain(FOREIGN_ACCOUNT_MASK);
  });

  test("ingest masks every field it writes, digest included", async () => {
    const marker = `redact-ingest-${RUN}`;
    await ingestConversation(
      conn,
      writerId,
      {
        summary: `Report about ${VICTIM_EMAIL} and its projects. ${marker}`,
        conversation_id: marker,
        title: `Handoff naming ${VICTIM_EMAIL}`,
        decisions: [`Assigned ${VICTIM_EMAIL}'s rows to a namespace`],
        observations: [`${VICTIM_EMAIL} has 187 memories`],
        open_questions: [`Does ${VICTIM_EMAIL} still need this?`],
        entities: [
          {
            name: `Entity for ${marker}`,
            type: "project",
            summary: `Owner is ${VICTIM_EMAIL}`,
          },
        ],
        namespace: NS,
      },
      "test",
    );

    // Every row the ingest produced, read back from the table.
    const rows = await queryMemories(conn, writerId, {
      namespace: NS,
      q: marker,
      limit: 50,
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(String(row.content)).not.toContain(VICTIM_EMAIL);
    }

    // The digest's own title lives in metadata, not content — check it too.
    const digests = await conn
      .select({ content: memories.content, metadata: memories.metadata })
      .from(memories)
      .where(and(eq(memories.namespaceId, nsId)));
    const digest = digests.find(
      (d) => (d.metadata as { conversation_id?: string })?.conversation_id === marker,
    );
    expect(digest).toBeDefined();
    expect(JSON.stringify(digest?.metadata)).not.toContain(VICTIM_EMAIL);
    expect(String(digest?.content)).not.toContain(VICTIM_EMAIL);
  });

  test("the masked row is still the caller's and still findable", async () => {
    const marker = `redact-find-${RUN}`;
    await createMemory(
      conn,
      writerId,
      {
        content: `${marker} concerns ${VICTIM_EMAIL}`,
        namespace: NS,
        type: "fact",
      },
      "test",
    );
    const hits = await queryMemories(conn, writerId, {
      namespace: NS,
      q: marker,
      limit: 10,
    });
    expect(hits.length).toBe(1);
    expect(String(hits[0]!.content)).toContain(marker);
    expect(String(hits[0]!.content)).not.toContain(VICTIM_EMAIL);
  });

  // ── Entity summaries are searchable prose too ───────────────────────────
  test("an entity summary cannot carry a foreign account either", async () => {
    const created = await createEntity(conn, writerId, NS, {
      name: `Entity ${RUN}`,
      type: "project",
      summary: `Operated by ${VICTIM_EMAIL}`,
    });
    const rows = await conn
      .select({ summary: entities.summary })
      .from(entities)
      .where(eq(entities.namespaceId, nsId));
    const row = rows.find((r) => String(r.summary).includes("Operated by"));
    expect(row).toBeDefined();
    expect(String(row?.summary)).not.toContain(VICTIM_EMAIL);
    expect(String(row?.summary)).toContain(FOREIGN_ACCOUNT_MASK);
    expect(created).toBeDefined();
  });
});
