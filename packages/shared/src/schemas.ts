import * as v from "valibot";
import {
  DEFAULT_IMPORTANCE,
  DEFAULT_NAMESPACE,
  IMPORTANCE_MAX,
  IMPORTANCE_MIN,
  MAX_ENTITY_LINKS,
  MAX_TAGS,
  MEMORY_TYPES,
  QUERY_LIMIT_MAX,
  SEARCH_LIMIT_MAX,
  TAG_MAX_LENGTH,
  TRAVERSE_DEPTH_MAX,
} from "./types.ts";

/**
 * Valibot schemas for the memory knowledge graph. These are the single source
 * of truth: the MCP tools validate against them, the REST API (dashboard)
 * will validate against them, and `scripts/gen-skill-ref.ts` regenerates the
 * skill reference from them.
 */

export const importanceSchema = v.pipe(
  v.number(),
  v.minValue(IMPORTANCE_MIN),
  v.maxValue(IMPORTANCE_MAX),
);

export const uuidSchema = v.pipe(v.string(), v.uuid());

/** Metadata is a free-form object. */
export const metadataSchema = v.record(v.string(), v.unknown());

/** Namespace input (create/rename). */
export const NamespaceInput = v.object({
  name: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
  description: v.optional(v.string(), ""),
});

/** Tags: lowercase, trimmed, deduped, capped. */
export const tagsSchema = v.pipe(
  v.array(v.pipe(v.string(), v.maxLength(TAG_MAX_LENGTH))),
  v.maxLength(MAX_TAGS),
);

/** Entity input for create. */
export const EntityInput = v.object({
  name: v.pipe(
    v.string(),
    v.minLength(1),
    v.maxLength(200),
    v.description("Entity name (1-200 chars)"),
  ),
  type: v.pipe(
    v.string(),
    v.minLength(1),
    v.maxLength(64),
    v.description(
      "person | project | tool | concept | repo (unknown → concept + tag)",
    ),
  ),
  summary: v.optional(v.string(), ""),
  importance: v.optional(importanceSchema, DEFAULT_IMPORTANCE),
  metadata: v.optional(metadataSchema, {}),
  tags: v.optional(tagsSchema, []),
});

/** Entity input for update — any subset of fields. */
export const EntityUpdateInput = v.object({
  name: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(200))),
  type: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(64))),
  summary: v.optional(v.string()),
  importance: v.optional(importanceSchema),
  metadata: v.optional(metadataSchema),
  tags: v.optional(tagsSchema),
});

/** Relation input for create. */
export const RelationInput = v.object({
  source_id: v.pipe(uuidSchema, v.description("Source entity UUID")),
  target_id: v.pipe(uuidSchema, v.description("Target entity UUID")),
  relation_type: v.pipe(
    v.string(),
    v.minLength(1),
    v.maxLength(64),
    v.description("Edge label, e.g. 'uses', 'works-on', 'prefers'"),
  ),
  weight: v.optional(
    v.pipe(importanceSchema, v.description("Edge weight 0-1 (default 0.5)")),
    DEFAULT_IMPORTANCE,
  ),
});

/** Memory input for create. */
export const MemoryInput = v.object({
  content: v.pipe(
    v.string(),
    v.minLength(1),
    v.maxLength(4000),
    v.description("The memory content (1-4000 chars)"),
  ),
  type: v.optional(
    v.pipe(
      v.picklist(MEMORY_TYPES),
      v.description(
        "fact | observation | preference | instruction (default fact)",
      ),
    ),
    "fact",
  ),
  importance: v.optional(
    v.pipe(
      importanceSchema,
      v.description(
        "0-1: 0.9+ core identity/preferences, 0.6-0.8 project facts, 0.3-0.5 observations, ≤0.2 transient",
      ),
    ),
    DEFAULT_IMPORTANCE,
  ),
  namespace: v.optional(v.string(), DEFAULT_NAMESPACE),
  entity_ids: v.optional(
    v.pipe(
      v.array(uuidSchema),
      v.maxLength(MAX_ENTITY_LINKS),
      v.description("Link 0-3 entities (UUIDs)"),
    ),
    [],
  ),
  metadata: v.optional(metadataSchema, {}),
  tags: v.optional(tagsSchema, []),
});

/** Memory update — content/type/importance/metadata/archived/tags; entity_ids REPLACES the link set. */
export const MemoryUpdateInput = v.object({
  content: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(4000))),
  type: v.optional(v.picklist(MEMORY_TYPES)),
  importance: v.optional(importanceSchema),
  metadata: v.optional(metadataSchema),
  archived: v.optional(v.boolean()),
  entity_ids: v.optional(
    v.pipe(v.array(uuidSchema), v.maxLength(MAX_ENTITY_LINKS)),
  ),
  tags: v.optional(tagsSchema),
});

/** One entity referenced by a conversation (find-or-create on ingest). */
export const ConversationEntity = v.object({
  name: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
  type: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
  summary: v.optional(v.string(), ""),
});

/**
 * A distilled conversation (handoff digest). The DEPARTING agent builds this
 * at the end of a session so the NEXT agent can continue without the raw
 * transcript. One digest per major topic — group multiple digests with the
 * same `conversation_id`.
 *
 * Technique (not dependency): query-aware compression — keep decisions,
 * preferences, instructions, and exact observations VERBATIM; drop filler.
 * The digest is the entry point; constituents are the evidence.
 */
export const ConversationInput = v.object({
  /** The digest — structured markdown, ≤4000 chars (anti-dump: split into more digests, don't pad). */
  summary: v.pipe(
    v.string(),
    v.minLength(1),
    v.maxLength(4000),
    v.description(
      "The digest — structured markdown, ≤4000 chars (anti-dump: split into more digests, don't pad)",
    ),
  ),
  /** Groups digests of the same conversation (one per major topic). */
  conversation_id: v.pipe(
    v.string(),
    v.minLength(1),
    v.maxLength(200),
    v.description(
      "Groups digests of the same conversation (one per major topic)",
    ),
  ),
  /** Human-readable name — how you tell conversations apart when resuming. Stored in digest metadata. */
  title: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(200))),
  /** Lifecycle state: active (resume me) | paused | done. Default active. Stored in digest metadata. */
  status: v.optional(
    v.pipe(
      v.picklist(["active", "paused", "done"]),
      v.description(
        "Lifecycle state: active (resume me) | paused | done. Default active",
      ),
    ),
    "active",
  ),
  /** Decisions made (what + why). Stored as `fact` memories. */
  decisions: v.optional(v.array(v.pipe(v.string(), v.maxLength(4000))), []),
  /** User preferences stated. Stored as `preference` memories. */
  preferences: v.optional(v.array(v.pipe(v.string(), v.maxLength(4000))), []),
  /** Conventions / how-to-behave rules. Stored as `instruction` memories. */
  instructions: v.optional(v.array(v.pipe(v.string(), v.maxLength(4000))), []),
  /** Exact observations: errors, stack traces, verbatim quotes. Stored as `observation` memories. */
  observations: v.optional(v.array(v.pipe(v.string(), v.maxLength(4000))), []),
  /** Open questions / next steps. Stored as `observation` memories tagged `open-question`. */
  open_questions: v.optional(
    v.array(v.pipe(v.string(), v.maxLength(4000))),
    [],
  ),
  /** Entities referenced — find-or-create in the namespace. */
  entities: v.optional(v.array(ConversationEntity), []),
  /** Source AI + pointer to the raw session (session log path or share URL). */
  source: v.optional(
    v.pipe(
      v.object({
        ai: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
        ref: v.optional(v.pipe(v.string(), v.maxLength(1000)), ""),
      }),
      v.description(
        "Source AI + pointer to the raw session (session log path or share URL)",
      ),
    ),
  ),
  /**
   * Optional verbatim transcript — ONLY if it exists (online chat models may
   * not expose one; the `source.ref` pointer is the primary fidelity
   * mechanism). Stored in digest metadata, excluded from search.
   */
  transcript: v.optional(v.pipe(v.string(), v.maxLength(100_000))),
  namespace: v.optional(v.string(), DEFAULT_NAMESPACE),
  /** Topic tags (e.g. auth, migration). `conversation` is added automatically. */
  tags: v.optional(tagsSchema, []),
});

/** Unified search input. */
export const SearchInput = v.object({
  // Empty q is allowed — it returns recent items (see search tool docs).
  q: v.pipe(
    v.string(),
    v.maxLength(200),
    v.description(
      "Search query (required; empty returns recent items). Multi-word = AND-of-words; exact phrases rank first",
    ),
  ),
  namespace: v.optional(
    v.pipe(v.string(), v.description("Restrict to a namespace")),
  ),
  // Memory type (fact/observation/preference/instruction) OR entity type
  // (person/project/tool/concept/repo) — search covers both axes.
  type: v.optional(
    v.pipe(
      v.string(),
      v.maxLength(64),
      v.description(
        "Memory type (fact/observation/preference/instruction) OR entity type (person/project/tool/concept/repo)",
      ),
    ),
  ),
  /** match memories/entities carrying ALL of these tags */
  tags: v.optional(
    v.pipe(
      tagsSchema,
      v.description("Match memories/entities carrying ALL of these tags"),
    ),
  ),
  limit: v.optional(
    v.pipe(
      v.number(),
      v.minValue(1),
      v.maxValue(SEARCH_LIMIT_MAX),
      v.description("Max results (default 10, max 25)"),
    ),
    10,
  ),
});

/** Graph traversal input. */
export const TraverseInput = v.object({
  start_id: v.pipe(
    uuidSchema,
    v.description("Entity UUID to start the BFS walk from"),
  ),
  depth: v.optional(
    v.pipe(
      v.number(),
      v.minValue(1),
      v.maxValue(TRAVERSE_DEPTH_MAX),
      v.description("Walk depth (default 1, max 3)"),
    ),
    1,
  ),
});

/** Consolidation sweep input. */
export const ConsolidateInput = v.object({});

/**
 * ── Tool-level schemas (the `action` enum pattern) ─────────────────────────
 * Each `manage_*` tool covers several actions through an action union,
 * keeping the LLM-facing tool surface to 7 while covering every capability.
 */

export const NamespaceToolInput = v.object({
  action: v.pipe(
    v.union([
      v.literal("create"),
      v.literal("list"),
      v.literal("get"),
      v.literal("delete"),
    ]),
    v.description(
      "create (name, description?) | list | get (id or name) | delete (id or name — cascades all contents)",
    ),
  ),
  name: v.optional(
    v.pipe(
      v.string(),
      v.minLength(1),
      v.maxLength(64),
      v.description("Namespace name (1-64 chars)"),
    ),
  ),
  id: v.optional(
    v.pipe(uuidSchema, v.description("Namespace UUID (or use name)")),
  ),
  description: v.optional(
    v.pipe(v.string(), v.description("Optional description")),
    "",
  ),
});

export const EntityToolInput = v.object({
  action: v.pipe(
    v.union([
      v.literal("create"),
      v.literal("get"),
      v.literal("update"),
      v.literal("delete"),
      v.literal("find"),
      v.literal("batch_update"),
    ]),
    v.description(
      "create (entity) | get (id) | update (id + update) | delete (id — cascades relations, unlinks memories) | find (query, optional type) | batch_update (where + update — updates ALL matching, returns count)",
    ),
  ),
  namespace: v.optional(
    v.pipe(
      v.string(),
      v.description("Namespace to operate in (default 'personal')"),
    ),
    DEFAULT_NAMESPACE,
  ),
  id: v.optional(v.pipe(uuidSchema, v.description("Entity UUID"))),
  entity: v.optional(
    v.pipe(
      EntityInput,
      v.description(
        "Entity to create: {name, type, summary?, importance?, metadata?, tags?}. Type is normalized to person|project|tool|concept|repo (unknown → concept + tag)",
      ),
    ),
  ),
  update: v.optional(
    v.pipe(
      EntityUpdateInput,
      v.description("Any subset of name/type/summary/importance/metadata/tags"),
    ),
  ),
  /** find: name to match (exact or substring) */
  query: v.optional(
    v.pipe(
      v.string(),
      v.description("find: name to match (exact or substring)"),
    ),
  ),
  /** find: optional type filter */
  type: v.optional(
    v.pipe(v.string(), v.description("find: optional type filter")),
  ),
  /** batch_update: update all entities matching these filters (at least one required) */
  where: v.optional(
    v.pipe(
      v.object({
        type: v.optional(v.string()),
        namespace: v.optional(v.string()),
        query: v.optional(v.string()),
      }),
      v.description(
        "batch_update: filters — at least one of type/namespace/query required",
      ),
    ),
  ),
  /** batch_update: max rows to touch (default 100, max 500) */
  batch_limit: v.optional(
    v.pipe(
      v.number(),
      v.minValue(1),
      v.maxValue(500),
      v.description("batch_update: max rows to touch (default 100, max 500)"),
    ),
    100,
  ),
});

export const RelationToolInput = v.object({
  action: v.pipe(
    v.union([v.literal("create"), v.literal("delete"), v.literal("list")]),
    v.description(
      "create (relation) | delete (id) | list (by entity_id or namespace)",
    ),
  ),
  relation: v.optional(
    v.pipe(
      RelationInput,
      v.description(
        "Relation to create: {source_id, target_id, relation_type, weight?} — updates weight if the same relation exists",
      ),
    ),
  ),
  id: v.optional(v.pipe(uuidSchema, v.description("Relation UUID"))),
  /** list: filter by entity (in + out) or by namespace */
  entity_id: v.optional(
    v.pipe(uuidSchema, v.description("list: filter by entity (in + out)")),
  ),
  namespace: v.optional(
    v.pipe(v.string(), v.description("list: filter by namespace")),
  ),
});

export const MemoryToolInput = v.object({
  action: v.pipe(
    v.union([
      v.literal("create"),
      v.literal("get"),
      v.literal("update"),
      v.literal("delete"),
      v.literal("query"),
      v.literal("batch_update"),
      v.literal("ingest"),
    ]),
    v.description(
      "create (memory) | get (id) | update (id + update) | delete (id) | query (filters) | batch_update (where + update — updates ALL matching, returns count) | ingest (conversation — handoff digest)",
    ),
  ),
  id: v.optional(v.pipe(uuidSchema, v.description("Memory UUID"))),
  memory: v.optional(
    v.pipe(
      MemoryInput,
      v.description(
        "Memory to create: {content, type? fact|observation|preference|instruction, importance? 0-1, namespace?, entity_ids? [0-3], metadata?, tags?} — source auto-set to client name",
      ),
    ),
  ),
  update: v.optional(
    v.pipe(
      MemoryUpdateInput,
      v.description(
        "Any subset of content/type/importance/metadata/archived/tags — entity_ids REPLACES the link set, tags REPLACES the tag set",
      ),
    ),
  ),
  /** ingest: the distilled conversation (digest + constituents + entities). */
  conversation: v.optional(
    v.pipe(
      ConversationInput,
      v.description(
        "ingest: distilled conversation {summary ≤4000, conversation_id, title?, status? active|paused|done, decisions?, preferences?, instructions?, observations?, open_questions?, entities?, source? {ai, ref?}, transcript? ≤100k, namespace?, tags?} — atomically saves a digest (tag 'conversation', importance 0.85) + constituent memories + entities. Use when the user says 'save this conversation' or is switching AIs mid-task",
      ),
    ),
  ),
  /** query filters */
  type: v.optional(
    v.pipe(
      v.picklist(MEMORY_TYPES),
      v.description("query: memory type filter"),
    ),
  ),
  namespace: v.optional(
    v.pipe(
      v.string(),
      v.description("query: namespace filter (default 'personal')"),
    ),
    DEFAULT_NAMESPACE,
  ),
  importance_min: v.optional(
    v.pipe(importanceSchema, v.description("query: minimum importance (0-1)")),
  ),
  archived: v.optional(
    v.pipe(
      v.boolean(),
      v.description("query: include archived (default false)"),
    ),
    false,
  ),
  /** query: match memories carrying ALL of these tags */
  tags: v.optional(
    v.pipe(
      tagsSchema,
      v.description("query: match memories carrying ALL of these tags"),
    ),
  ),
  limit: v.optional(
    v.pipe(
      v.number(),
      v.minValue(1),
      v.maxValue(QUERY_LIMIT_MAX),
      v.description("query: max results (default 20, max 50)"),
    ),
    20,
  ),
  /** batch_update: update all memories matching these filters (at least one required) */
  where: v.optional(
    v.pipe(
      v.object({
        type: v.optional(v.picklist(MEMORY_TYPES)),
        namespace: v.optional(v.string()),
        tags: v.optional(tagsSchema),
        importance_min: v.optional(importanceSchema),
        q: v.optional(v.string()),
      }),
      v.description(
        "batch_update: filters — at least one of type/namespace/tags/importance_min/q required",
      ),
    ),
  ),
  /** batch_update: max rows to touch (default 100, max 500) */
  batch_limit: v.optional(
    v.pipe(
      v.number(),
      v.minValue(1),
      v.maxValue(500),
      v.description("batch_update: max rows to touch (default 100, max 500)"),
    ),
    100,
  ),
});

export const SearchToolInput = SearchInput;

export const TraverseToolInput = TraverseInput;

export const ConsolidateToolInput = v.object({});

/** All tool names, exported for tests and the smoke script. */
export const TOOL_NAMES = [
  "manage_namespace",
  "manage_entity",
  "manage_relation",
  "manage_memory",
  "search",
  "traverse_graph",
  "consolidate",
] as const;
