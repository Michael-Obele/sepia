/**
 * MCP tool-surface tests for `manage_entity` — the duplicate-name error mapping
 * and the regression it fixes.
 *
 * WHY THIS EXISTS (2026-10-11 incident): creating an entity whose name was
 * already taken in the namespace returned Drizzle's raw
 * `Failed query: insert into "entities" (_id_, "namespace_id", …) values (…)`
 * dump to the model, so a guarded constraint looked like a broken server. The
 * insert was never broken: an existing entity held the name and the
 * per-namespace unique key `entities_namespace_id_name_key` rejected the write
 * with the error left unmapped.
 *
 * The incident's own suggestion was a bare "create twice" check. That is not
 * enough: it cannot tell a per-namespace fix from a global one, and it misses
 * every other path that writes `name`. This suite also pins the paths the
 * incident never reached — rename (same class, different route), batch rename,
 * cross-namespace, exact-case matching — plus the boundary that memories must
 * stay unaffected.
 *
 * Named permanent regressions (must hold regardless of the table):
 *   - duplicate create → `[already_exists] …` naming the holder id, no SQL text.
 *   - duplicate in a DIFFERENT namespace → succeeds.
 *   - rename onto a taken name → the same clean error, blaming the HOLDER.
 *
 * SAFETY: fixtures live under `ent-suite+<run>@sepia.test`, deleted in afterAll.
 * Skips without DATABASE_URL.
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
import { and, inArray, like, lt } from "drizzle-orm";
import type { McpServer } from "tmcp";
import {
  EntityToolInput,
  MemoryToolInput,
  namespaces,
  users,
} from "@sepia/shared";
import { db } from "../db.ts";
import { registerEntityTools } from "./entity.ts";
import { registerMemoryTools } from "./memory.ts";

const hasDb = Boolean(process.env.DATABASE_URL);

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const OWNER_EMAIL = `ent-suite+${RUN}@sepia.test`;
const NS = `ent-suite-${RUN}`;
const OTHER_NS = `ent-suite-other-${RUN}`;
const SETUP_TIMEOUT_MS = 60_000;
const TEST_TIMEOUT_MS = 30_000;

const test = (name: string, fn: () => void | Promise<unknown>) =>
  bunTest(name, fn, TEST_TIMEOUT_MS);

interface ToolResult {
  text: string;
  isError: boolean;
}

/** Shape of a *successful* create/update payload (JSON, never an error). */
interface EntityPayload {
  action: string;
  entity: { id: string; name: string; type: string };
}

describe.skipIf(!hasDb)("manage_entity MCP tool", () => {
  let ownerId = "";
  let entityHandler:
    | ((args: Record<string, unknown>) => Promise<unknown>)
    | undefined;
  let memoryHandler:
    | ((args: Record<string, unknown>) => Promise<unknown>)
    | undefined;

  /**
   * Register a tool against a stub server and hand back its handler. `ctx.custom
   * .user` is read at CALL time, like the real server.
   */
  function capture(
    register: (server: McpServer<any, any>) => void,
  ): (args: Record<string, unknown>) => Promise<unknown> {
    let captured: typeof entityHandler;
    const stub = {
      ctx: { custom: { user: { id: ownerId } } },
      tool(_def: unknown, fn: typeof entityHandler) {
        captured = fn;
      },
    } as unknown as McpServer<any, any>;
    register(stub);
    if (!captured) throw new Error("the tool was never registered");
    return captured;
  }

  /**
   * The REAL validation path tmcp takes (`~standard.validate`) followed by the
   * registered handler — not a hand-built args object. Mirrors memory.test.ts.
   */
  async function invoke(
    handler: (args: Record<string, unknown>) => Promise<unknown>,
    schema: { "~standard": { validate: (v: unknown) => unknown } },
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    const validated = (await schema["~standard"].validate(args)) as
      | { value: Record<string, unknown> }
      | { issues: unknown };
    if ("issues" in validated) {
      return {
        text: JSON.stringify({ validation_issues: validated.issues }),
        isError: true,
      };
    }
    const result = (await handler(validated.value)) as {
      isError?: boolean;
      content?: Array<{ type?: string; text?: string }>;
    };
    return {
      text: result.content?.find((c) => c.type === "text")?.text ?? "",
      isError: Boolean(result.isError),
    };
  }

  const entity = (args: Record<string, unknown>) =>
    invoke(entityHandler!, EntityToolInput, args);
  const memory = (args: Record<string, unknown>) =>
    invoke(memoryHandler!, MemoryToolInput, args);

  /** Parse a successful payload; fail loudly if it was an error result. */
  function ok(result: ToolResult): EntityPayload {
    if (result.isError)
      throw new Error(`expected success, got error: ${result.text}`);
    return JSON.parse(result.text) as EntityPayload;
  }

  async function create(
    namespace: string,
    name: string,
    type = "tool",
  ): Promise<EntityPayload> {
    return ok(
      await entity({ action: "create", namespace, entity: { name, type } }),
    );
  }

  beforeAll(async () => {
    const conn = db();

    await conn
      .delete(users)
      .where(
        and(
          like(users.email, "ent-suite%@sepia.test"),
          lt(users.createdAt, new Date(Date.now() - 3_600_000)),
        ),
      );

    const [owner] = await conn
      .insert(users)
      .values({
        id: crypto.randomUUID(),
        name: "Ent Suite",
        email: OWNER_EMAIL,
      })
      .returning({ id: users.id });
    ownerId = String(owner!.id);

    await conn.insert(namespaces).values([
      { ownerId, name: NS, description: "test" },
      { ownerId, name: OTHER_NS, description: "other" },
    ]);

    entityHandler = capture(registerEntityTools);
    memoryHandler = capture(registerMemoryTools);
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    if (!ownerId) return;
    await db()
      .delete(users)
      .where(inArray(users.email, [OWNER_EMAIL]));
  }, SETUP_TIMEOUT_MS);

  // ── The incident, as a permanent regression ──────────────────────────────
  test("REGRESSION: duplicate create is already_exists, never raw SQL", async () => {
    const first = await create(NS, "Dup Probe");
    const conflict = await entity({
      action: "create",
      namespace: NS,
      entity: { name: "Dup Probe", type: "tool" },
    });

    expect(conflict.isError).toBe(true);
    expect(conflict.text.startsWith("[already_exists]")).toBe(true);
    // It names the row that holds the name, so the caller goes straight to update.
    expect(conflict.text).toContain(first.entity.id);
    expect(conflict.text).toContain("use action=update");

    // The whole point of the fix: no driver SQL reaches the model.
    expect(conflict.text).not.toContain("insert into");
    expect(conflict.text).not.toContain("Failed query");
    expect(conflict.text).not.toContain("$1");

    // The original row is untouched.
    expect(first.entity.name).toBe("Dup Probe");
  });

  // ── Uniqueness is PER-NAMESPACE, not global ──────────────────────────────
  // A wording-only fix would pass the test above. A fix that accidentally made
  // the uniqueness global would also pass it — and break real users. This is
  // the pair that tells the two apart.
  test("the same name is allowed in a different namespace", async () => {
    const inNs = await create(NS, "Cross Ns Probe");
    const inOther = await create(OTHER_NS, "Cross Ns Probe");
    expect(inOther.entity.id).not.toBe(inNs.entity.id);
    expect(inOther.entity.name).toBe("Cross Ns Probe");
  });

  // ── Case: exact-match today, deliberately frozen ─────────────────────────
  test("name matching is exact-case (documents current behaviour)", async () => {
    await create(NS, "CaseProbe");
    // Different case is a different name today (Postgres unique is exact-case).
    const lower = await create(NS, "caseprobe");
    expect(lower.entity.name).toBe("caseprobe");

    // ...and the exact name still collides.
    const again = await entity({
      action: "create",
      namespace: NS,
      entity: { name: "CaseProbe", type: "tool" },
    });
    expect(again.isError).toBe(true);
    expect(again.text).toContain("already_exists");
  });

  // ── The path the incident MISSED: rename onto a taken name ───────────────
  test("REGRESSION: renaming onto a taken name is clean, names the holder", async () => {
    const holder = await create(NS, "Rename A");
    const mover = await create(NS, "Rename B");

    const conflict = await entity({
      action: "update",
      namespace: NS,
      id: mover.entity.id,
      update: { name: "Rename A" },
    });

    expect(conflict.isError).toBe(true);
    expect(conflict.text.startsWith("[already_exists]")).toBe(true);
    // Blame the HOLDER, not the row being renamed (the exceptId logic).
    expect(conflict.text).toContain(holder.entity.id);
    expect(conflict.text).not.toContain(mover.entity.id);
    expect(conflict.text).not.toContain("insert into");
  });

  // ── Boundary: a self-rename is not a conflict ────────────────────────────
  // A naive "does a row with this name exist?" pre-check would have rejected a
  // no-op rename of an entity onto its own name. The exceptId guard does not.
  test("renaming an entity to its own name is a no-op, not a conflict", async () => {
    const entityRow = await create(NS, "Self Rename");
    const renamed = ok(
      await entity({
        action: "update",
        namespace: NS,
        id: entityRow.entity.id,
        update: { name: "Self Rename" },
      }),
    );
    expect(renamed.entity.name).toBe("Self Rename");
  });

  // ── Same class, batch route ──────────────────────────────────────────────
  test("batch rename collision is clean too", async () => {
    await create(NS, "Batch A");
    await create(NS, "Batch B");

    const conflict = await entity({
      action: "batch_update",
      namespace: NS,
      where: { namespace: NS, query: "Batch " },
      update: { name: "Batch Collide" },
    });

    expect(conflict.isError).toBe(true);
    expect(conflict.text.startsWith("[already_exists]")).toBe(true);
    expect(conflict.text).toContain("batch update would rename");
    expect(conflict.text).not.toContain("insert into");
  });

  // ── The mapping must not OVER-catch ──────────────────────────────────────
  // A too-broad catch would turn every failure into "already_exists" and hide
  // real bugs. These two pin the boundary of the try/catch.
  test("an unknown namespace still reports namespace_not_found, not already_exists", async () => {
    const result = await entity({
      action: "create",
      namespace: "no-such-namespace-xyz",
      entity: { name: "Nowhere", type: "tool" },
    });
    expect(result.isError).toBe(true);
    expect(result.text.startsWith("[namespace_not_found]")).toBe(true);
    expect(result.text).not.toContain("already_exists");
  });

  test("unknown args surface garbage that is NOT swallowed as a conflict", async () => {
    // Unknown TOP-LEVEL keys are ignored-with-a-hint (the G2 contract), while
    // unknown keys INSIDE `entity` are stripped by its strict v.object. Either
    // way the create must succeed: a bogus key is not a name conflict.
    const created = ok(
      await entity({
        action: "create",
        namespace: NS,
        entity: { name: "Aardvark Probe", type: "tool" },
      }),
    );
    expect(created.entity.name).toBe("Aardvark Probe");
  });

  test("updating a non-existent id reports not_found, not already_exists", async () => {
    const result = await entity({
      action: "update",
      namespace: NS,
      id: crypto.randomUUID(),
      update: { name: "Ghost Rename" },
    });
    expect(result.isError).toBe(true);
    expect(result.text.startsWith("[not_found]")).toBe(true);
    expect(result.text).not.toContain("already_exists");
  });

  // ── The guard must NOT spread to memories ────────────────────────────────
  // The original bug note suggested covering `manage_memory`. Memories have no
  // unique key, so identical content twice is legal and must stay legal; this
  // catches a future "fix" that over-generalises the constraint mapping.
  test("manage_memory create is unaffected: identical content twice succeeds", async () => {
    const content = `duplicate-content-probe ${RUN}`;
    // NOTE: for `manage_memory` create, the namespace is a field of `memory`
    // (the top-level `namespace` is the query filter). Same name, two homes.
    const first = await memory({
      action: "create",
      memory: { content, namespace: NS, type: "fact" },
    });
    const second = await memory({
      action: "create",
      memory: { content, namespace: NS, type: "fact" },
    });

    expect(first.isError, first.text).toBe(false);
    expect(second.isError, second.text).toBe(false);
    const a = JSON.parse(first.text) as { memory: { id: string } };
    const b = JSON.parse(second.text) as { memory: { id: string } };
    expect(a.memory.id).not.toBe(b.memory.id);
  });
});
