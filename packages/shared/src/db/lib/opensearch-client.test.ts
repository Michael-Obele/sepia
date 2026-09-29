/**
 * Unit tests for the fetch-based OpenSearch client — NO cluster required.
 * globalThis.fetch is mocked; the password must never be observable anywhere
 * (URL, logs, error messages) and env handling must be deterministic even
 * when a real .env exists (the exclusive envOverride test seam).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  INDEX_BODY,
  OsError,
  __setEnvForTest,
  bulkIndex,
  deleteDoc,
  ensureIndex,
  indexDoc,
  opensearchEnabled,
  osIndex,
  osRequest,
  type OsIndexDoc,
} from "./opensearch-client.ts";

const BASE = "https://os.example:18048";
const calls: { url: string; init: RequestInit }[] = [];
const origFetch = globalThis.fetch;

function mockFetch(status: number, body: unknown = {}) {
  globalThis.fetch = (async (
    url: string | URL | Request,
    init?: RequestInit,
  ) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

/** Sequential mock: response N is consumed by call N (last repeats). */
function mockFetchSeq(responses: Array<{ status: number; body?: unknown }>) {
  let i = 0;
  globalThis.fetch = (async (
    url: string | URL | Request,
    init?: RequestInit,
  ) => {
    calls.push({ url: String(url), init: init ?? {} });
    const r = responses[Math.min(i, responses.length - 1)]!;
    i++;
    return new Response(JSON.stringify(r.body ?? {}), {
      status: r.status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

const doc: OsIndexDoc = {
  kind: "memory",
  id: "11111111-1111-1111-1111-111111111111",
  owner_id: "o1",
  namespace_id: "n1",
  namespace: "personal",
  type: "fact",
  tags: ["always"],
  archived: false,
  importance: 0.5,
  updated_at: "2026-09-29T00:00:00.000Z",
  haystack: "bun deploy guide",
  content: "bun deploy guide",
};

/** A GET /<index> response for an index WITH the correct analyzer. */
const GOOD_GET = {
  mappings: {
    properties: { haystack: { type: "text", analyzer: "sepia_edge" } },
  },
};

beforeEach(() => {
  calls.length = 0;
  __setEnvForTest({
    url: BASE,
    user: "osuser",
    password: "sekret",
    index: "sepia_test",
  });
});
afterEach(() => {
  globalThis.fetch = origFetch;
  __setEnvForTest(null);
});

describe("opensearch-client", () => {
  test("disabled when URL unset — even if process.env says otherwise", () => {
    __setEnvForTest({});
    expect(opensearchEnabled()).toBe(false);
  });

  test("enabled with a URL; index defaults + override", () => {
    expect(opensearchEnabled()).toBe(true);
    expect(osIndex()).toBe("sepia_test");
    __setEnvForTest({ url: BASE });
    expect(osIndex()).toBe("sepia_docs");
  });

  test("basic auth header present; password never in the URL", async () => {
    mockFetch(200, { status: "green" });
    await osRequest("GET", "/_cluster/health");
    const auth = (calls[0]!.init.headers as Record<string, string>)[
      "authorization"
    ];
    expect(auth).toBe(`Basic ${btoa("osuser:sekret")}`);
    expect(calls[0]!.url).not.toContain("sekret");
    expect(calls[0]!.url).toBe(`${BASE}/_cluster/health`);
  });

  test("no auth header when password unset (security-disabled clusters)", async () => {
    __setEnvForTest({ url: BASE });
    mockFetch(200, {});
    await osRequest("GET", "/_x");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers["authorization"]).toBeUndefined();
  });

  test("OsError carries status; message never contains the password", async () => {
    mockFetch(401, { error: "unauthorized" });
    const err = (await osRequest("GET", "/_x").catch((e) => e)) as OsError;
    expect(err).toBeInstanceOf(OsError);
    expect(err.status).toBe(401);
    expect(String(err.message)).not.toContain("sekret");
    expect(String(err.message)).toBe("GET /_x -> HTTP 401");
  });

  test("missing config rejects before any network call", async () => {
    __setEnvForTest({});
    const err = (await osRequest("GET", "/_x").catch((e) => e)) as OsError;
    expect(err).toBeInstanceOf(OsError);
    expect(calls.length).toBe(0);
  });

  test("string bodies pass through untouched (NDJSON for _bulk)", async () => {
    mockFetchSeq([
      { status: 200, body: GOOD_GET }, // ensureIndex verification
      { status: 200, body: { errors: false, items: [] } },
    ]);
    await bulkIndex([doc]);
    const bulkCall = calls.find((c) => c.url.includes("_bulk"))!;
    const headers = bulkCall.init.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/x-ndjson");
    expect(String(bulkCall.init.body)).toContain(`"${doc.kind}:${doc.id}"`);
    expect(String(bulkCall.init.body).endsWith("\n")).toBe(true);
  });

  test("bulkIndex with no docs makes no request", async () => {
    mockFetch(200, {});
    await bulkIndex([]);
    expect(calls.length).toBe(0);
  });

  test("bulkIndex throws when the response reports item errors", async () => {
    mockFetchSeq([
      { status: 200, body: GOOD_GET },
      {
        status: 200,
        body: {
          errors: true,
          items: [
            { index: { status: 409, error: { type: "version_conflict" } } },
          ],
        },
      },
    ]);
    const err = (await bulkIndex([doc]).catch((e) => e)) as OsError;
    expect(err).toBeInstanceOf(OsError);
    expect(err.message).toMatch(/_bulk/);
  });

  test("indexDoc targets _doc/<kind>:<id>; refresh=wait_for under test flag", async () => {
    mockFetchSeq([
      { status: 200, body: GOOD_GET },
      { status: 200, body: {} },
    ]);
    process.env.OPENSEARCH_TEST_REFRESH = "1";
    try {
      await indexDoc(doc);
    } finally {
      delete process.env.OPENSEARCH_TEST_REFRESH;
    }
    const put = calls.find((c) => c.init.method === "PUT")!;
    expect(put.url).toBe(
      `${BASE}/sepia_test/_doc/memory:${doc.id}?refresh=wait_for`,
    );
  });

  test("deleteDoc tolerates 404 (already gone = success)", async () => {
    delete process.env.OPENSEARCH_TEST_REFRESH; // deterministic: flag off
    mockFetch(404, {});
    await expect(deleteDoc("memory:abc")).resolves.toBeUndefined();
    // Flag off: NO query string at all (both branches now pinned).
    expect(calls[0]!.url).toBe(`${BASE}/sepia_test/_doc/memory:abc`);
  });

  test("deleteDoc honors OPENSEARCH_TEST_REFRESH (post-delete assertions)", async () => {
    process.env.OPENSEARCH_TEST_REFRESH = "1";
    try {
      mockFetch(200, {});
      await deleteDoc(`memory:${doc.id}`);
    } finally {
      delete process.env.OPENSEARCH_TEST_REFRESH;
    }
    expect(calls[0]!.url).toBe(
      `${BASE}/sepia_test/_doc/memory:${doc.id}?refresh=wait_for`,
    );
  });

  test("deleteDoc propagates real failures", async () => {
    mockFetch(500, {});
    const err = (await deleteDoc("memory:abc").catch((e) => e)) as OsError;
    expect(err.status).toBe(500);
  });

  test("timeout wired via AbortSignal", async () => {
    mockFetch(200, {});
    await osRequest("GET", "/_x");
    expect(calls[0]!.init.signal).toBeDefined();
  });
});

describe("ensureIndex (auto-create hazard guard)", () => {
  test("404 → creates with INDEX_BODY exactly once (memoized)", async () => {
    mockFetchSeq([
      { status: 404 },
      { status: 200, body: { acknowledged: true } },
    ]);
    await ensureIndex();
    await ensureIndex(); // memo — no extra requests
    expect(calls.length).toBe(2);
    expect(calls[0]!.url).toBe(`${BASE}/sepia_test`);
    expect(calls[0]!.init.method).toBe("GET");
    expect(calls[1]!.init.method).toBe("PUT");
    expect(String(calls[1]!.init.body)).toContain("sepia_edge");
  });

  test("existing index WITH the analyzer → verified, no PUT", async () => {
    mockFetchSeq([{ status: 200, body: GOOD_GET }]);
    await ensureIndex();
    expect(calls.length).toBe(1);
    expect(calls[0]!.init.method).toBe("GET");
  });

  test("existing index WITHOUT the analyzer → refuses with --drop hint", async () => {
    mockFetchSeq([{ status: 200, body: { mappings: { properties: {} } } }]);
    const err = (await ensureIndex().catch((e) => e)) as OsError;
    expect(err).toBeInstanceOf(OsError);
    expect(err.message).toContain("--drop");
    expect(calls.length).toBe(1); // never PUTs over it, never writes docs
  });

  test("a write refuses to land on a wrong-mapping index (ensure-before-write)", async () => {
    mockFetchSeq([{ status: 200, body: { mappings: { properties: {} } } }]);
    const err = (await indexDoc(doc).catch((e) => e)) as OsError;
    expect(err).toBeInstanceOf(OsError);
    expect(err.message).toContain("--drop");
    // Only the verification GET happened — the doc was NOT written.
    expect(calls.length).toBe(1);
    expect(calls[0]!.init.method).toBe("GET");
  });

  test("bulkIndex honors OPENSEARCH_TEST_REFRESH (fixtures visible immediately)", async () => {
    process.env.OPENSEARCH_TEST_REFRESH = "1";
    try {
      mockFetchSeq([
        { status: 200, body: GOOD_GET },
        { status: 200, body: { errors: false, items: [] } },
      ]);
      await bulkIndex([doc]);
    } finally {
      delete process.env.OPENSEARCH_TEST_REFRESH;
    }
    const bulkCall = calls.find((c) => c.url.includes("_bulk"));
    expect(bulkCall!.url).toContain("refresh=wait_for");
  });
});

describe("INDEX_BODY (prefix-recall contract)", () => {
  test("edge-ngram index analyzer + standard search analyzer on haystack", () => {
    const props = INDEX_BODY.mappings.properties as Record<string, unknown>;
    const haystack = props.haystack as Record<string, string>;
    expect(haystack.analyzer).toBe("sepia_edge");
    expect(haystack.search_analyzer).toBe("standard");
    const tokenizer =
      INDEX_BODY.settings.analysis.tokenizer.edge_ngram_tokenizer;
    expect(tokenizer.type).toBe("edge_ngram");
    expect(tokenizer.min_gram).toBe(2);
    expect(INDEX_BODY.settings.analysis.analyzer.sepia_edge.filter).toContain(
      "lowercase",
    );
  });
  test("filter fields are keyword; display-only fields are not indexed", () => {
    const props = INDEX_BODY.mappings.properties as Record<string, any>;
    for (const f of [
      "kind",
      "owner_id",
      "namespace_id",
      "namespace",
      "type",
      "tags",
    ]) {
      expect(props[f].type).toBe("keyword");
    }
    expect(props.archived.type).toBe("boolean");
    expect(props.importance.type).toBe("float");
    expect(props.updated_at.type).toBe("date");
    expect(props.content.index).toBe(false);
    expect(props.name.index).toBe(false);
    expect(props.summary.index).toBe(false);
  });
});
