/**
 * Unit tests for doc building — pure functions, NO cluster, NO database.
 * The haystack contract is the load-bearing part: it must match exactly what
 * coverage search matches (content + digest title/conversation_id/source_ai)
 * and must NEVER contain the transcript.
 */
import { describe, expect, test } from "bun:test";
import {
  buildEntityDoc,
  buildMemoryDoc,
  type SyncEntityRow,
  type SyncMemoryRow,
} from "./index-sync.ts";

const memRow: SyncMemoryRow = {
  id: "11111111-1111-1111-1111-111111111111",
  namespaceId: "22222222-2222-2222-2222-222222222222",
  content: "Bun powers Sepia",
  type: "fact",
  importance: 0.8,
  tags: ["always"],
  archived: false,
  metadata: {
    kind: "conversation",
    title: "Deploy log",
    conversation_id: "deploy-log-2026",
    source_ai: "Copilot",
    transcript: "HUGE TRANSCRIPT must never be indexed",
  },
  updatedAt: new Date("2026-09-29T00:00:00Z"),
  namespace: "personal",
  ownerId: "33333333-3333-3333-3333-333333333333",
};

const entRow: SyncEntityRow = {
  id: "44444444-4444-4444-4444-444444444444",
  namespaceId: "22222222-2222-2222-2222-222222222222",
  name: "Sepia",
  type: "project",
  summary: "Memory MCP server",
  importance: 0.9,
  tags: ["flagship"],
  updatedAt: "2026-09-29T00:00:00.000Z",
  namespace: "personal",
  ownerId: "33333333-3333-3333-3333-333333333333",
};

describe("buildMemoryDoc", () => {
  test("haystack includes content + title + conversation_id + source_ai", () => {
    const doc = buildMemoryDoc(memRow)!;
    expect(doc.haystack).toContain("Bun powers Sepia");
    expect(doc.haystack).toContain("Deploy log");
    expect(doc.haystack).toContain("deploy-log-2026");
    expect(doc.haystack).toContain("Copilot");
  });

  test("haystack NEVER contains the transcript", () => {
    const doc = buildMemoryDoc(memRow)!;
    expect(doc.haystack).not.toContain("HUGE TRANSCRIPT");
    expect(doc.haystack).not.toContain("transcript");
  });

  test("filter + display fields carried with coverage semantics", () => {
    const doc = buildMemoryDoc(memRow)!;
    expect(doc.kind).toBe("memory");
    expect(doc.id).toBe(memRow.id);
    expect(doc.owner_id).toBe("33333333-3333-3333-3333-333333333333");
    expect(doc.namespace_id).toBe(memRow.namespaceId);
    expect(doc.namespace).toBe("personal");
    expect(doc.type).toBe("fact");
    expect(doc.tags).toEqual(["always"]);
    expect(doc.archived).toBe(false);
    expect(doc.importance).toBe(0.8);
    expect(doc.updated_at).toBe("2026-09-29T00:00:00.000Z");
    expect(doc.content).toBe("Bun powers Sepia");
  });

  test("archived=true is preserved (query filters it via must_not)", () => {
    const doc = buildMemoryDoc({ ...memRow, archived: true })!;
    expect(doc.archived).toBe(true);
  });

  test("null metadata degrades gracefully", () => {
    const doc = buildMemoryDoc({ ...memRow, metadata: null })!;
    expect(doc.haystack).toBe("Bun powers Sepia");
  });

  test("null/missing row → null (caller deletes the doc)", () => {
    expect(buildMemoryDoc(null)).toBeNull();
    expect(buildMemoryDoc({} as SyncMemoryRow)).toBeNull();
  });
});

describe("buildEntityDoc", () => {
  test("haystack = name + summary (coverage's entHaystack)", () => {
    const doc = buildEntityDoc(entRow)!;
    expect(doc.haystack).toBe("Sepia Memory MCP server");
    expect(doc.kind).toBe("entity");
    expect(doc.name).toBe("Sepia");
    expect(doc.summary).toBe("Memory MCP server");
    expect(doc.archived).toBeUndefined();
  });

  test("null row → null", () => {
    expect(buildEntityDoc(null)).toBeNull();
  });
});
