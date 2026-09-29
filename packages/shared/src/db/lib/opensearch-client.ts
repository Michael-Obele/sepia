/**
 * Minimal OpenSearch HTTP client — global fetch, zero dependencies.
 *
 * WHY NOT @opensearch-project/opensearch: Bun's fetch covers everything Sepia
 * needs (basic auth, timeout, JSON) with no Node-oriented transport tree to
 * audit or debug on a runtime the upstream client does not test against.
 *
 * Safety contract (the silent-arg-drop guardrail class):
 *   - The password lives only in env (.env / Fly secrets) — never in a URL,
 *     never in a log, never in an error message.
 *   - Every failure surfaces as a typed `OsError` (method + path + status) so
 *     call sites can fall back to the coverage engine instead of swallowing.
 */

export class OsError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "OsError";
  }
}

interface OsEnv {
  url?: string;
  user?: string;
  password?: string;
  index?: string;
  timeoutMs?: number;
}

/**
 * Test seam. `null` = read process.env (production path); an object = use it
 * EXCLUSIVELY (so unit tests are deterministic even when a real .env exists).
 */
let envOverride: OsEnv | null = null;

export function __setEnvForTest(e: OsEnv | null): void {
  envOverride = e;
  ensuredKey = null; // a new env (url/index) must re-verify the mapping
}

function env(): Required<OsEnv> {
  if (envOverride !== null) {
    return {
      url: (envOverride.url ?? "").replace(/\/+$/, ""),
      user: envOverride.user ?? "",
      password: envOverride.password ?? "",
      index: envOverride.index ?? "sepia_docs",
      timeoutMs: envOverride.timeoutMs ?? 2000,
    };
  }
  return {
    url: (process.env.OPENSEARCH_URL ?? "").replace(/\/+$/, ""),
    user: process.env.OPENSEARCH_USER ?? "",
    password: process.env.OPENSEARCH_PASSWORD ?? "",
    index: process.env.OPENSEARCH_INDEX ?? "sepia_docs",
    timeoutMs: process.env.OPENSEARCH_TIMEOUT_MS
      ? Number(process.env.OPENSEARCH_TIMEOUT_MS)
      : 2000,
  };
}

/** Configured? False → sync hooks no-op and search falls back to coverage. */
export function opensearchEnabled(): boolean {
  return env().url.length > 0;
}

/** The index every operation targets (tests point this at `sepia_test`). */
export function osIndex(): string {
  return env().index;
}

function authHeader(): string | undefined {
  const { user, password } = env();
  if (!user || !password) return undefined;
  return `Basic ${btoa(`${user}:${password}`)}`;
}

/**
 * Raw request. Throws `OsError` on missing config, network/timeout failure,
 * non-2xx status, or a non-JSON body. A string body is sent as-is (NDJSON for
 * `_bulk`); objects are JSON-encoded.
 */
export async function osRequest<T>(
  method: "GET" | "PUT" | "POST" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const { url, timeoutMs } = env();
  if (!url) throw new OsError("OPENSEARCH_URL is not set");
  const isNdjson = path.includes("/_bulk");
  const headers: Record<string, string> = { accept: "application/json" };
  if (body !== undefined) {
    headers["content-type"] = isNdjson
      ? "application/x-ndjson"
      : "application/json";
  }
  const auth = authHeader();
  if (auth) headers["authorization"] = auth;

  let res: Response;
  try {
    res = await fetch(`${url}${path}`, {
      method,
      headers,
      body:
        body === undefined
          ? undefined
          : typeof body === "string"
            ? body
            : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    // Timeout / DNS / TLS. `err.name` only — messages can embed the URL, and
    // the URL must never carry credentials (auth goes in the header).
    throw new OsError(
      `${method} ${path}: ${err instanceof Error ? err.name : "fetch failed"}`,
    );
  }
  const text = await res.text();
  if (!res.ok)
    throw new OsError(`${method} ${path} -> HTTP ${res.status}`, res.status);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new OsError(`${method} ${path} -> non-JSON response`, res.status);
  }
}

/**
 * Index settings + mappings — exported so unit tests can pin the shape that
 * prefix recall depends on (edge-ngram index analyzer + standard search
 * analyzer; `migr` must find `migration`).
 */
export const INDEX_BODY = {
  settings: {
    analysis: {
      analyzer: {
        sepia_edge: {
          type: "custom",
          tokenizer: "edge_ngram_tokenizer",
          filter: ["lowercase"],
        },
      },
      tokenizer: {
        edge_ngram_tokenizer: {
          type: "edge_ngram",
          min_gram: 2,
          max_gram: 20,
          token_chars: ["letter", "digit"],
        },
      },
    },
  },
  mappings: {
    properties: {
      kind: { type: "keyword" },
      owner_id: { type: "keyword" },
      namespace_id: { type: "keyword" },
      namespace: { type: "keyword" },
      type: { type: "keyword" },
      tags: { type: "keyword" },
      archived: { type: "boolean" },
      importance: { type: "float" },
      updated_at: { type: "date" },
      haystack: {
        type: "text",
        analyzer: "sepia_edge",
        search_analyzer: "standard",
      },
      // Stored for snippet rendering only — deliberately NOT indexed.
      content: { type: "text", index: false },
      name: { type: "text", index: false },
      summary: { type: "text", index: false },
    },
  },
} as const;

export interface OsIndexDoc {
  kind: "memory" | "entity";
  id: string;
  owner_id: string;
  namespace_id: string;
  namespace: string;
  type: string;
  tags: string[];
  archived?: boolean;
  importance: number;
  updated_at: string;
  haystack: string;
  content?: string;
  name?: string;
  summary?: string;
}

/**
 * Create the index with mappings if missing — and VERIFY the mapping when it
 * exists. Memoized per url+index so the write paths can call it cheaply.
 *
 * WHY THE VERIFICATION: OpenSearch auto-creates an index on first write with
 * DEFAULT mappings. Without this check, one mutation sent before `os:backfill`
 * would freeze an analyzer-less index into place (analysis settings are not
 * updatable) and silently kill prefix recall forever. A wrong-mapping index
 * now fails loudly with the fix command instead.
 */
let ensuredKey: string | null = null;

export async function ensureIndex(): Promise<void> {
  if (!opensearchEnabled()) return;
  const { url, index } = env();
  const key = `${url}|${index}`;
  if (ensuredKey === key) return;

  let exists = true;
  let meta: Record<string, any> | undefined;
  try {
    meta = await osRequest<Record<string, any>>("GET", `/${index}`);
  } catch (err) {
    if (err instanceof OsError && err.status === 404) exists = false;
    else throw err;
  }
  if (!exists) {
    await osRequest("PUT", `/${index}`, INDEX_BODY);
    ensuredKey = key;
    return;
  }
  // The field mapping is what prefix recall depends on, and analyzer settings
  // on a field are immutable after creation — so this is the durable check.
  const haystack = meta?.mappings?.properties?.haystack;
  if (haystack?.analyzer !== "sepia_edge") {
    throw new OsError(
      `index '${index}' exists WITHOUT the sepia_edge analyzer on haystack (auto-created with default mappings?) — prefix recall is dead until it is rebuilt: bun run os:backfill -- --drop`,
    );
  }
  ensuredKey = key;
}

/** Bulk upsert — one round trip per mutation batch. Throws if any item failed. */
export async function bulkIndex(docs: OsIndexDoc[]): Promise<void> {
  if (!docs.length) return;
  await ensureIndex(); // never let a write auto-create a default-mapping index
  const refresh =
    process.env.OPENSEARCH_TEST_REFRESH === "1" ? "wait_for" : "false";
  const lines = docs.flatMap((d) => [
    JSON.stringify({ index: { _index: osIndex(), _id: `${d.kind}:${d.id}` } }),
    JSON.stringify(d),
  ]);
  const res = await osRequest<{ errors?: boolean; items?: unknown[] }>(
    "POST",
    `/_bulk?refresh=${refresh}`,
    `${lines.join("\n")}\n`,
  );
  if (res.errors) {
    const failed = (res.items ?? []).filter(
      (it) => (it as { index?: { status?: number } })?.index?.status !== 200,
    ).length;
    throw new OsError(`_bulk: ${failed || "some"} item(s) failed`);
  }
}

/** Single upsert (create/update hooks). */
export async function indexDoc(doc: OsIndexDoc): Promise<void> {
  await ensureIndex(); // never let a write auto-create a default-mapping index
  // Integration tests set OPENSEARCH_TEST_REFRESH=1 so a write is searchable
  // by the very next assertion instead of racing OpenSearch's ~1s refresh.
  const refresh =
    process.env.OPENSEARCH_TEST_REFRESH === "1" ? "wait_for" : "false";
  await osRequest(
    "PUT",
    `/${osIndex()}/_doc/${doc.kind}:${doc.id}?refresh=${refresh}`,
    doc,
  );
}

/** Remove one doc. 404 = already gone = success. */
export async function deleteDoc(id: string): Promise<void> {
  // Same test-refresh contract as writes: a delete must be searchable by the
  // next assertion (the round-trip test checks a doc is GONE immediately).
  const refresh =
    process.env.OPENSEARCH_TEST_REFRESH === "1" ? "?refresh=wait_for" : "";
  try {
    await osRequest("DELETE", `/${osIndex()}/_doc/${id}${refresh}`);
  } catch (err) {
    if (err instanceof OsError && err.status === 404) return;
    throw err;
  }
}

/** Purge docs matching a filter — namespace delete uses this. */
export async function deleteByQuery(
  filter: Record<string, unknown>[],
): Promise<void> {
  await osRequest("POST", `/${osIndex()}/_delete_by_query?refresh=true`, {
    query: { bool: { filter } },
  });
}

export async function clusterHealth(): Promise<{ status: string }> {
  return osRequest("GET", "/_cluster/health");
}
