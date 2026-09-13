/**
 * Sepia REST API client — the transport behind every MCP tool.
 *
 * The self-contained `sepia-mcp` package is a thin MCP wrapper over the Sepia
 * REST API (`SEPIA_URL/api/*`). Auth is a Bearer token (`SEPIA_API_KEY`, the
 * same value as the server's MCP_BEARER_TOKEN). Every tool call maps to one or
 * more REST routes; the server owns the DB and the tenant boundary.
 */

export interface SepiaClientOptions {
  /** Base URL of the Sepia server, e.g. https://sepia.fly.dev (no trailing slash). */
  baseUrl: string;
  /** Bearer token — the server's MCP_BEARER_TOKEN / an API key. */
  apiKey: string;
  /** Client name reported as the memory `source` on create/ingest. */
  source?: string;
}

export class SepiaApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SepiaApiError";
  }
}

export class SepiaClient {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly source: string;

  constructor(opts: SepiaClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.source = opts.source ?? "sepia-mcp";
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      ...extra,
    };
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: this.headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      let code = "http_error";
      let message = `HTTP ${res.status}`;
      try {
        const data = (await res.json()) as {
          error?: { code?: string; message?: string };
        };
        if (data.error?.code) code = data.error.code;
        if (data.error?.message) message = data.error.message;
      } catch {
        // non-JSON error body — keep the HTTP status message
      }
      throw new SepiaApiError(res.status, code, message);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  // ── Namespaces ──────────────────────────────────────────────────────────
  listNamespaces() {
    return this.request<{ namespaces: unknown[] }>("GET", "/api/namespaces");
  }
  createNamespace(name: string, description?: string) {
    return this.request<{ namespace: unknown }>("POST", "/api/namespaces", {
      name,
      description,
    });
  }
  getNamespace(idOrName: string) {
    return this.request<{ namespace: unknown }>(
      "GET",
      `/api/namespaces/${encodeURIComponent(idOrName)}`,
    );
  }
  deleteNamespace(idOrName: string) {
    return this.request<{ deleted: unknown }>(
      "DELETE",
      `/api/namespaces/${encodeURIComponent(idOrName)}`,
    );
  }

  // ── Entities ────────────────────────────────────────────────────────────
  findEntities(params: {
    namespace?: string;
    q?: string;
    type?: string;
    limit?: number;
  }) {
    const qs = new URLSearchParams();
    if (params.namespace !== undefined) qs.set("namespace", params.namespace);
    if (params.q !== undefined) qs.set("q", params.q);
    if (params.type !== undefined) qs.set("type", params.type);
    if (params.limit !== undefined) qs.set("limit", String(params.limit));
    const suffix = qs.size ? `?${qs.toString()}` : "";
    return this.request<{ count: number; entities: unknown[] }>(
      "GET",
      `/api/entities${suffix}`,
    );
  }
  createEntity(namespace: string, entity: unknown) {
    return this.request<{ entity: unknown }>("POST", "/api/entities", {
      namespace,
      ...(entity as Record<string, unknown>),
    });
  }
  getEntity(id: string) {
    return this.request<{ entity: unknown }>("GET", `/api/entities/${id}`);
  }
  updateEntity(id: string, update: unknown) {
    return this.request<{ entity: unknown }>(
      "PATCH",
      `/api/entities/${id}`,
      update,
    );
  }
  deleteEntity(id: string) {
    return this.request<{ deleted: unknown }>("DELETE", `/api/entities/${id}`);
  }
  batchUpdateEntities(where: unknown, update: unknown, batch_limit?: number) {
    return this.request<{ count: number }>("POST", "/api/entities/batch", {
      where,
      update,
      batch_limit,
    });
  }

  // ── Memories ────────────────────────────────────────────────────────────
  queryMemories(params: {
    type?: string;
    namespace?: string;
    importance_min?: number;
    archived?: boolean;
    tags?: string[];
    limit?: number;
  }) {
    const qs = new URLSearchParams();
    if (params.type !== undefined) qs.set("type", params.type);
    if (params.namespace !== undefined) qs.set("namespace", params.namespace);
    if (params.importance_min !== undefined)
      qs.set("importance_min", String(params.importance_min));
    if (params.archived !== undefined)
      qs.set("archived", String(params.archived));
    if (params.tags !== undefined && params.tags.length)
      qs.set("tags", params.tags.join(","));
    if (params.limit !== undefined) qs.set("limit", String(params.limit));
    const suffix = qs.size ? `?${qs.toString()}` : "";
    return this.request<{ count: number; memories: unknown[] }>(
      "GET",
      `/api/memories${suffix}`,
    );
  }
  createMemory(memory: unknown) {
    return this.request<{ memory: unknown }>("POST", "/api/memories", memory);
  }
  getMemory(id: string) {
    return this.request<{ memory: unknown }>("GET", `/api/memories/${id}`);
  }
  updateMemory(id: string, update: unknown) {
    return this.request<{ memory: unknown }>(
      "PATCH",
      `/api/memories/${id}`,
      update,
    );
  }
  deleteMemory(id: string) {
    return this.request<{ deleted: unknown }>("DELETE", `/api/memories/${id}`);
  }
  batchUpdateMemories(where: unknown, update: unknown, batch_limit?: number) {
    return this.request<{ count: number }>("POST", "/api/memories/batch", {
      where,
      update,
      batch_limit,
    });
  }

  // ── Conversations (handoff digests) ─────────────────────────────────────
  ingestConversation(conversation: unknown) {
    return this.request<{ result: unknown }>(
      "POST",
      "/api/conversations",
      conversation,
    );
  }
  getConversation(conversationId: string, namespace?: string) {
    const qs = new URLSearchParams({ conversation_id: conversationId });
    if (namespace !== undefined) qs.set("namespace", namespace);
    return this.request<{ count: number; memories: unknown[] }>(
      "GET",
      `/api/conversations?${qs.toString()}`,
    );
  }

  // ── Relations ───────────────────────────────────────────────────────────
  listRelations(params: { entity_id?: string; namespace?: string }) {
    const qs = new URLSearchParams();
    if (params.entity_id !== undefined) qs.set("entity_id", params.entity_id);
    if (params.namespace !== undefined) qs.set("namespace", params.namespace);
    const suffix = qs.size ? `?${qs.toString()}` : "";
    return this.request<{ count: number; relations: unknown[] }>(
      "GET",
      `/api/relations${suffix}`,
    );
  }
  createRelation(relation: unknown) {
    return this.request<{ relation: unknown }>(
      "POST",
      "/api/relations",
      relation,
    );
  }
  deleteRelation(id: string) {
    return this.request<{ deleted: unknown }>("DELETE", `/api/relations/${id}`);
  }

  // ── Search / graph / consolidate ────────────────────────────────────────
  search(params: {
    q: string;
    namespace?: string;
    type?: string;
    tags?: string[];
    limit?: number;
  }) {
    const qs = new URLSearchParams({ q: params.q });
    if (params.namespace !== undefined) qs.set("namespace", params.namespace);
    if (params.type !== undefined) qs.set("type", params.type);
    if (params.tags !== undefined && params.tags.length)
      qs.set("tags", params.tags.join(","));
    if (params.limit !== undefined) qs.set("limit", String(params.limit));
    return this.request<{ count: number; results: unknown[] }>(
      "GET",
      `/api/search?${qs.toString()}`,
    );
  }
  traverseGraph(startId: string, depth?: number) {
    const qs = new URLSearchParams({ root: startId });
    if (depth !== undefined) qs.set("depth", String(depth));
    return this.request<unknown>("GET", `/api/graph?${qs.toString()}`);
  }
  consolidate() {
    return this.request<{ result: unknown }>("POST", "/api/consolidate");
  }
}
