/**
 * G3 surface-parity test — DB-free, runs in the docs.yml-style CI job.
 *
 * Contract (packages/shared/src/filter-sets.ts): every declared filter key
 * must be (1) present on the tool schema, (2) forwarded by each surface,
 * (3) named in agent-facing docs. This file asserts (1) structurally and
 * greps the surface sources for (2); src/tools/memory.test.ts asserts (2)
 * behaviorally against a live DB through the real tmcp validation path.
 *
 * Why not iterate schema keys: the 2026-09-29 incident was a key the schema
 * DIDN'T have. Schema-anchored iteration is blind to that.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ENTITY_FIND_FILTERS,
  FILTER_OMITTED,
  MEMORY_QUERY_FILTERS,
  MemoryToolInput,
  RELATION_LIST_FILTERS,
  SEARCH_FILTERS,
  EntityToolInput,
  RelationToolInput,
  SearchInput,
} from "@sepia/shared";

const ROOT = resolve(import.meta.dir, "..");

/** Read a repo source file relative to the root. */
function src(path: string): string {
  return readFileSync(resolve(ROOT, path), "utf8");
}

/** Extract the top-level entries of a valibot object schema. */
function schemaKeys(schema: { entries: Record<string, unknown> }): string[] {
  return Object.keys(schema.entries);
}

describe("declared filter sets match their schemas", () => {
  test("MEMORY_QUERY_FILTERS are all declared on MemoryToolInput", () => {
    const keys = new Set(schemaKeys(MemoryToolInput));
    const missing = MEMORY_QUERY_FILTERS.filter((k) => !keys.has(k));
    expect(
      missing,
      `MemoryToolInput is missing: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  test("ENTITY_FIND_FILTERS are all declared on EntityToolInput", () => {
    const keys = new Set(schemaKeys(EntityToolInput));
    const missing = ENTITY_FIND_FILTERS.filter((k) => !keys.has(k));
    expect(
      missing,
      `EntityToolInput is missing: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  test("SEARCH_FILTERS are all declared on SearchInput", () => {
    const keys = new Set(schemaKeys(SearchInput));
    const missing = SEARCH_FILTERS.filter((k) => !keys.has(k));
    expect(missing, `SearchInput is missing: ${missing.join(", ")}`).toEqual(
      [],
    );
  });

  test("RELATION_LIST_FILTERS are all declared on RelationToolInput", () => {
    const keys = new Set(schemaKeys(RelationToolInput));
    const missing = RELATION_LIST_FILTERS.filter((k) => !keys.has(k));
    expect(missing).toEqual([]);
  });
});

describe("every surface forwards its declared filters", () => {
  // Each entry: filter set → the source regions that must mention each key.
  // A grep hit is deliberately coarse; memory.test.ts proves behavior. This
  // catches the wiring classes: schema-declared-but-handler-ignored (L3) and
  // surface divergence (L4).
  const surfaces: Array<{
    name: string;
    file: string;
    keys: readonly string[];
    /** Extract the region to grep (so unrelated code can't satisfy it). */
    region: (text: string) => string;
    /** Keys legitimately absent from this surface (must be in FILTER_OMITTED). */
    omitted?: string[];
  }> = [
    {
      name: "MCP hub handler (manage_memory query)",
      file: "src/tools/memory.ts",
      keys: MEMORY_QUERY_FILTERS,
      region: (t) =>
        t.slice(t.indexOf('case "query"'), t.indexOf('case "briefing"')),
    },
    {
      name: "stdio handler (manage_memory query)",
      file: "packages/sepia-mcp/src/tools/memory.ts",
      keys: MEMORY_QUERY_FILTERS,
      region: (t) =>
        t.slice(t.indexOf('case "query"'), t.indexOf('case "briefing"')),
    },
    {
      name: "stdio client (queryMemories)",
      file: "packages/sepia-mcp/src/client.ts",
      keys: MEMORY_QUERY_FILTERS,
      region: (t) =>
        t.slice(t.indexOf("queryMemories(params"), t.indexOf("getBriefing(")),
    },
    {
      name: "REST GET /api/memories",
      file: "src/api.ts",
      keys: MEMORY_QUERY_FILTERS,
      region: (t) =>
        t.slice(
          t.indexOf('path === "/api/memories" && method === "GET"'),
          t.indexOf('path === "/api/memories" && method === "POST"'),
        ),
    },
    {
      name: "MCP hub handler (manage_entity find)",
      file: "src/tools/entity.ts",
      keys: ENTITY_FIND_FILTERS,
      region: (t) =>
        t.slice(t.indexOf('case "find"'), t.indexOf('case "batch_update"')),
      // offset/limit on find: dashboard-only pagination is declared here for
      // MCP; if a surface omits one it must appear in FILTER_OMITTED.
    },
    {
      name: "REST GET /api/search",
      file: "src/api.ts",
      keys: SEARCH_FILTERS,
      region: (t) =>
        t.slice(t.indexOf('path === "/api/search"'), t.indexOf("── Graph")),
    },
    {
      name: "stdio search handler",
      file: "packages/sepia-mcp/src/tools/search.ts",
      keys: SEARCH_FILTERS,
      region: (t) =>
        t.slice(t.indexOf("client.search("), t.indexOf("return { count")),
    },
  ];

  for (const surface of surfaces) {
    test(`${surface.name} mentions every declared key`, () => {
      const text = src(surface.file);
      const region = surface.region(text);
      expect(
        region.length,
        `region not found in ${surface.file}`,
      ).toBeGreaterThan(20);
      const omitted = new Set(surface.omitted ?? []);
      const missing = surface.keys.filter(
        (k) => !omitted.has(k) && !region.includes(k),
      );
      expect(
        missing,
        `${surface.name} does not forward: ${missing.join(", ")}`,
      ).toEqual([]);
    });
  }

  test("FILTER_OMITTED entries are documented, not silent", () => {
    // Every omission must carry a non-empty reason — the allowlist exists so
    // a gap is a decision, not an accident.
    for (const [key, entry] of Object.entries(FILTER_OMITTED)) {
      expect(
        entry.reason.length,
        `FILTER_OMITTED[${key}] has no reason`,
      ).toBeGreaterThan(10);
    }
  });
});

describe("loose schemas keep unknown keys (G2 precondition)", () => {
  test("MemoryToolInput preserves an unknown key through validation", async () => {
    const parsed = await MemoryToolInput["~standard"].validate({
      action: "query",
      bogus_key: 1,
    });
    if ("issues" in parsed) {
      throw new Error(`unexpected issues: ${JSON.stringify(parsed.issues)}`);
    }
    expect((parsed.value as Record<string, unknown>).bogus_key).toBe(1);
  });
});
