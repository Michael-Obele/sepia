/**
 * G7 + G8 — schema snapshot and docs↔schema parity. DB-free.
 *
 * G7 (snapshot): the published JSON schema of all 7 tools is committed as a
 * snapshot. Any surface change (a param added/removed/renamed, a description
 * edited) is a visible diff a reviewer must acknowledge — regenerate with
 *   UPDATE_TOOL_SNAPSHOTS=1 bun test scripts/tool-schema-snapshot.test.ts
 * Limit (forge-contract): a snapshot shows *change*, not *correctness* — a
 * wrong description shipped alongside an updated snapshot passes. That is
 * exactly G8's job.
 *
 * G8 (docs parity): what agent-facing docs and tool descriptions NAME must
 * exist in the schema, and what the schema DECLARES must appear in the docs.
 * This is the L5 layer — nothing enforced it before, so a description could
 * advertise a param that never existed (the class that produced the incident
 * as a *schema* gap, and would produce it again as a *docs* gap).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { ValibotJsonSchemaAdapter } from "@tmcp/adapter-valibot";
import {
  EntityToolInput,
  MemoryToolInput,
  MEMORY_QUERY_FILTERS,
  NamespaceToolInput,
  PruneMemoriesToolInput,
  RelationToolInput,
  SearchInput,
  WakeToolInput,
} from "@sepia/shared";

const ROOT = resolve(import.meta.dir, "..");
const SNAPSHOT = resolve(import.meta.dir, "__snapshots__", "tool-schemas.json");

/** The 7 tool schemas — the full MCP surface, one snapshot entry each. */
const TOOLS: Record<string, { entries: Record<string, unknown> }> = {
  manage_namespace: NamespaceToolInput,
  manage_entity: EntityToolInput,
  manage_relation: RelationToolInput,
  manage_memory: MemoryToolInput,
  search: SearchInput,
  wake: WakeToolInput,
  prune_memories: PruneMemoriesToolInput,
};

const adapter = new ValibotJsonSchemaAdapter();

async function buildSnapshot(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const [name, schema] of Object.entries(TOOLS)) {
    out[name] = await adapter.toJsonSchema(schema as never);
  }
  return out;
}

// ── G7: published schema snapshot ──────────────────────────────────────────
describe("G7: published tool schemas match the committed snapshot", () => {
  test("snapshot is current (regenerate: UPDATE_TOOL_SNAPSHOTS=1 bun test scripts/tool-schema-snapshot.test.ts)", async () => {
    const current = await buildSnapshot();
    const json = JSON.stringify(current, null, 2) + "\n";

    if (process.env.UPDATE_TOOL_SNAPSHOTS || !existsSync(SNAPSHOT)) {
      mkdirSync(resolve(SNAPSHOT, ".."), { recursive: true });
      writeFileSync(SNAPSHOT, json);
      if (!process.env.UPDATE_TOOL_SNAPSHOTS) {
        throw new Error(
          `snapshot did not exist — created at ${SNAPSHOT}. Review it and commit.`,
        );
      }
      return; // regeneration run: file written, nothing to compare
    }

    const committed = readFileSync(SNAPSHOT, "utf8");
    expect(
      json,
      "published schema changed — if intended, regenerate the snapshot and get the diff reviewed",
    ).toBe(committed);
  });

  test("every tool still exposes loose (unknown-key-tolerant) objects", async () => {
    // G2's contract: the published schema must NOT advertise
    // additionalProperties:false until strictObject phase 2 lands. If this
    // flips, connector clients may start pre-rejecting calls.
    const snap = (await buildSnapshot()) as Record<
      string,
      { additionalProperties?: boolean }
    >;
    for (const [name, schema] of Object.entries(snap)) {
      expect(
        schema.additionalProperties,
        `${name} publishes additionalProperties — G2 phase 1 expects it absent`,
      ).toBeUndefined();
    }
  });
});

// ── G8: docs/description ↔ schema parity ───────────────────────────────────
describe("G8: docs and descriptions only name params that exist", () => {
  const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

  test("llms.txt names every declared memory-query filter", () => {
    const text = read("llms.txt");
    // The manage_memory bullet — slice to the next numbered tool bullet.
    const start = text.indexOf("**`manage_memory`**");
    const end = text.indexOf("**`search`**", start);
    expect(start).toBeGreaterThan(-1);
    const bullet = text.slice(start, end);
    const missing = MEMORY_QUERY_FILTERS.filter((k) => !bullet.includes(k));
    expect(
      missing,
      `llms.txt manage_memory bullet missing: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  test("generated tools.md names every declared memory-query filter", () => {
    const text = read("skills/sepia/references/tools.md");
    const start = text.indexOf("`query`: filters");
    expect(start).toBeGreaterThan(-1);
    const line = text.slice(start, text.indexOf("\n", start));
    const missing = MEMORY_QUERY_FILTERS.filter((k) => !line.includes(k));
    expect(
      missing,
      `tools.md query line missing: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  test("tools.md query line names NOTHING the schema lacks (reverse)", () => {
    const text = read("skills/sepia/references/tools.md");
    const start = text.indexOf("`query`: filters");
    const line = text.slice(start, text.indexOf("\n", start));
    // `foo?` / `foo` tokens after "filters" up to ";"/"—" — the filter list.
    const filtersPart = line.slice(
      line.indexOf("filters") + "filters".length,
      line.indexOf(";"),
    );
    const named = [...filtersPart.matchAll(/([a-z_]+)\?/g)].map((m) => m[1]!);
    const schemaKeys = new Set(Object.keys(MemoryToolInput.entries));
    const phantom = named.filter((k) => !schemaKeys.has(k));
    expect(
      phantom,
      `tools.md advertises params the schema lacks: ${phantom.join(", ")}`,
    ).toEqual([]);
  });

  test("the manage_memory action description only names real query filters", () => {
    // valibot keeps v.description(...) in the entry's PIPE, not on the entry.
    const entry = MemoryToolInput.entries.action as unknown as {
      pipe?: ReadonlyArray<{ type?: string; description?: string }>;
    };
    const desc = entry.pipe?.find((p) => p.type === "description")?.description;
    expect(desc).toBeDefined();
    const m = desc!.match(/query \(filters: ([^)]+)\)/);
    expect(
      m,
      "action description lost its query-filters segment",
    ).not.toBeNull();
    const named = m![1]!
      .split("|")
      .map((s) => s.trim().split(/[\s`]/)[0]!)
      .filter(Boolean);
    const declared = new Set<string>(MEMORY_QUERY_FILTERS);
    const phantoms = named.filter((k) => !declared.has(k));
    expect(
      phantoms,
      `description names non-declared query filters: ${phantoms.join(", ")}`,
    ).toEqual([]);
    const unmentioned = [...declared].filter((k) => !named.includes(k));
    expect(
      unmentioned,
      `description omits declared query filters: ${unmentioned.join(", ")}`,
    ).toEqual([]);
  });

  test("the diagnostic rule is present in all three guidance surfaces", () => {
    // G6: the silent-arg-drop lesson must survive in the agent-facing docs.
    const surfaces: Array<[string, string]> = [
      ["llms.txt", read("llms.txt")],
      ["skills/sepia/SKILL.md", read("skills/sepia/SKILL.md")],
      [
        "packages/shared/src/types.ts (MEMORY_CONTRACT)",
        read("packages/shared/src/types.ts"),
      ],
    ];
    for (const [name, text] of surfaces) {
      // "identical" (not "identical results") — llms.txt writes *identical*
      // with markdown emphasis between the words.
      expect(
        text.includes("identical"),
        `${name} lost the identical-results diagnostic rule`,
      ).toBe(true);
      expect(
        text.includes("filters_applied"),
        `${name} lost the filters_applied pointer`,
      ).toBe(true);
    }
  });
});
