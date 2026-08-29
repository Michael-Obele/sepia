import {
  pgTable,
  unique,
  uniqueIndex,
  uuid,
  text,
  timestamp,
  index,
  foreignKey,
  jsonb,
  real,
  integer,
  boolean,
  primaryKey,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Sepia knowledge-graph schema — single source of truth for the DB shape.
 * Shared by the MCP server (Fly) and the dashboard (Netlify) so both talk to
 * the same Neon Postgres with the same table definitions — no drift.
 * Introspected from the live DB (constraint/index names match exactly), then
 * extended with: CHECK constraints (importance/weight ∈ [0,1], type whitelist),
 * UNIQUE(namespace_id, name) on entities, pg_trgm GIN indexes for ILIKE search,
 * and a partial index for the queryMemories hot path.
 */

// ── Accounts (Better Auth) ──────────────────────────────────────────────────
// Multi-tenant identity. `users.plan` is the billing tier (free | pro), set
// server-side only (manual assignment today, billing webhooks later).
// Ids are uuids via Better Auth's `advanced.database.generateId`.

export const users = pgTable(
  "users",
  {
    id: uuid().primaryKey().notNull(),
    name: text().notNull(),
    email: text().notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text(),
    plan: text().notNull().default("free"),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique("users_email_key").on(table.email)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid().primaryKey().notNull(),
    token: text().notNull(),
    userId: uuid("user_id").notNull(),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("sessions_token_key").on(table.token),
    index("idx_sessions_user").on(table.userId),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "sessions_user_id_fkey",
    }).onDelete("cascade"),
  ],
);

export const accounts = pgTable(
  "accounts",
  {
    id: uuid().primaryKey().notNull(),
    userId: uuid("user_id").notNull(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    // OAuth issuer (e.g. "https://accounts.google.com") — required by
    // Better Auth 1.7+ account model.
    issuer: text(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    scope: text(),
    password: text(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_accounts_user").on(table.userId),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "accounts_user_id_fkey",
    }).onDelete("cascade"),
  ],
);

export const verifications = pgTable(
  "verifications",
  {
    id: uuid().primaryKey().notNull(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
);

/**
 * API keys (Better Auth apiKey plugin) — per-user keys for local editors
 * (Claude Code, Cursor, Zed, Copilot). `referenceId` is the owning user id.
 * Table name is `apikey` (the plugin's API_KEY_TABLE_NAME). The export name
 * is `apikey` too — the Better Auth drizzle adapter resolves models by
 * schema key, and the plugin's model name is `apikey`.
 */
export const apikey = pgTable(
  "apikey",
  {
    id: uuid().primaryKey().notNull(),
    configId: text("config_id").notNull().default("default"),
    name: text(),
    start: text(),
    referenceId: uuid("reference_id").notNull(),
    prefix: text(),
    key: text().notNull(),
    refillInterval: integer("refill_interval"),
    refillAmount: integer("refill_amount"),
    lastRefillAt: timestamp("last_refill_at", {
      withTimezone: true,
      mode: "date",
    }),
    enabled: boolean().notNull().default(true),
    rateLimitEnabled: boolean("rate_limit_enabled").notNull().default(true),
    rateLimitTimeWindow: integer("rate_limit_time_window"),
    rateLimitMax: integer("rate_limit_max"),
    requestCount: integer("request_count").notNull().default(0),
    remaining: integer(),
    lastRequest: timestamp("last_request", {
      withTimezone: true,
      mode: "date",
    }),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
    permissions: text(),
    metadata: text(),
  },
  (table) => [
    unique("apikey_key_key").on(table.key),
    index("idx_apikey_reference").on(table.referenceId),
    foreignKey({
      columns: [table.referenceId],
      foreignColumns: [users.id],
      name: "apikey_reference_id_fkey",
    }).onDelete("cascade"),
  ],
);

/**
 * Namespaces — isolated memory containers. `ownerId` is the account that
 * owns the namespace (multi-tenant). Nullable only during the bootstrap
 * adoption window (existing data is adopted by the admin user at boot);
 * the application always sets it. Uniqueness is per-owner, not global.
 */
export const namespaces = pgTable(
  "namespaces",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    ownerId: uuid("owner_id"),
    name: text().notNull(),
    description: text().default(""),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "string",
    }).defaultNow(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "string",
    }).defaultNow(),
  },
  (table) => [
    // Per-owner name uniqueness (partial: NULL owners are pre-adoption rows).
    uniqueIndex("namespaces_owner_id_name_key")
      .on(table.ownerId, table.name)
      .where(sql`${table.ownerId} IS NOT NULL`),
    index("idx_namespaces_owner").on(table.ownerId),
    foreignKey({
      columns: [table.ownerId],
      foreignColumns: [users.id],
      name: "namespaces_owner_id_fkey",
    }).onDelete("cascade"),
  ],
);

export const entities = pgTable(
  "entities",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    namespaceId: uuid("namespace_id").notNull(),
    name: text().notNull(),
    type: text().notNull(),
    summary: text().default(""),
    metadata: jsonb().default({}),
    importance: real().default(0.5),
    accessCount: integer("access_count").default(0),
    tags: text("tags").array().default([]),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "string",
    }).defaultNow(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "string",
    }).defaultNow(),
  },
  (table) => [
    index("idx_entities_name").using(
      "btree",
      table.name.asc().nullsLast().op("text_ops"),
    ),
    index("idx_entities_namespace").using(
      "btree",
      table.namespaceId.asc().nullsLast().op("uuid_ops"),
    ),
    index("idx_entities_type").using(
      "btree",
      table.type.asc().nullsLast().op("text_ops"),
    ),
    // New: no two entities with the same name in the same namespace.
    unique("entities_namespace_id_name_key").on(table.namespaceId, table.name),
    // New: importance must stay in [0, 1].
    check(
      "entities_importance_check",
      sql`${table.importance} >= 0 AND ${table.importance} <= 1`,
    ),
    // New: type must be one of the five canonical entity types.
    // (Added in migration 0005 — after existing data was normalized.)
    check(
      "entities_type_check",
      sql`${table.type} IN ('person', 'project', 'tool', 'concept', 'repo')`,
    ),
    // New: trigram indexes for ILIKE '%x%' name/summary search.
    index("idx_entities_name_trgm").using("gin", table.name.op("gin_trgm_ops")),
    index("idx_entities_summary_trgm").using(
      "gin",
      table.summary.op("gin_trgm_ops"),
    ),
    // New: GIN index for tag containment queries (tags @> ARRAY[...]).
    index("idx_entities_tags").using("gin", table.tags),
    foreignKey({
      columns: [table.namespaceId],
      foreignColumns: [namespaces.id],
      name: "entities_namespace_id_fkey",
    }).onDelete("cascade"),
  ],
);

export const relations = pgTable(
  "relations",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    namespaceId: uuid("namespace_id").notNull(),
    sourceId: uuid("source_id").notNull(),
    targetId: uuid("target_id").notNull(),
    relationType: text("relation_type").notNull(),
    weight: real().default(0.5),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "string",
    }).defaultNow(),
  },
  (table) => [
    index("idx_relations_source").using(
      "btree",
      table.sourceId.asc().nullsLast().op("uuid_ops"),
    ),
    index("idx_relations_target").using(
      "btree",
      table.targetId.asc().nullsLast().op("uuid_ops"),
    ),
    // New: weight must stay in [0, 1].
    check(
      "relations_weight_check",
      sql`${table.weight} >= 0 AND ${table.weight} <= 1`,
    ),
    foreignKey({
      columns: [table.namespaceId],
      foreignColumns: [namespaces.id],
      name: "relations_namespace_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.sourceId],
      foreignColumns: [entities.id],
      name: "relations_source_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.targetId],
      foreignColumns: [entities.id],
      name: "relations_target_id_fkey",
    }).onDelete("cascade"),
    unique("relations_source_id_target_id_relation_type_key").on(
      table.sourceId,
      table.targetId,
      table.relationType,
    ),
  ],
);

export const memories = pgTable(
  "memories",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    namespaceId: uuid("namespace_id").notNull(),
    content: text().notNull(),
    type: text().default("fact"),
    importance: real().default(0.5),
    source: text(),
    metadata: jsonb().default({}),
    tags: text("tags").array().default([]),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "string",
    }).defaultNow(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "string",
    }).defaultNow(),
    archived: boolean().default(false),
  },
  (table) => [
    index("idx_memories_importance").using(
      "btree",
      table.importance.asc().nullsLast().op("float4_ops"),
    ),
    index("idx_memories_namespace").using(
      "btree",
      table.namespaceId.asc().nullsLast().op("uuid_ops"),
    ),
    index("idx_memories_type").using(
      "btree",
      table.type.asc().nullsLast().op("text_ops"),
    ),
    // New: importance must stay in [0, 1].
    check(
      "memories_importance_check",
      sql`${table.importance} >= 0 AND ${table.importance} <= 1`,
    ),
    // New: type must be one of the four known memory types.
    check(
      "memories_type_check",
      sql`${table.type} IN ('fact', 'observation', 'preference', 'instruction')`,
    ),
    // New: trigram index for the ILIKE '%x%' content search.
    index("idx_memories_content_trgm").using(
      "gin",
      table.content.op("gin_trgm_ops"),
    ),
    // New: GIN index for tag containment queries (tags @> ARRAY[...]).
    index("idx_memories_tags").using("gin", table.tags),
    // New: partial index for the queryMemories hot path (importance DESC, updated_at DESC).
    index("idx_memories_active")
      .on(
        table.namespaceId.asc().nullsLast().op("uuid_ops"),
        table.importance.desc().nullsLast().op("float4_ops"),
        table.updatedAt.desc().nullsLast().op("timestamptz_ops"),
      )
      .where(sql`NOT ${table.archived}`),
    foreignKey({
      columns: [table.namespaceId],
      foreignColumns: [namespaces.id],
      name: "memories_namespace_id_fkey",
    }).onDelete("cascade"),
  ],
);

export const oauthClients = pgTable(
  "oauth_clients",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    clientId: text("client_id").notNull(),
    clientSecret: text("client_secret"),
    name: text().notNull(),
    redirectUris: jsonb("redirect_uris").$type<string[]>().notNull().default([]),
    tokenEndpointAuthMethod: text("token_endpoint_auth_method").default("none"),
    // The account that authorized this client — an "AI connection".
    // Nullable: dynamic client registration is unauthenticated; the owner
    // is bound at first authorize (plan limit counts these).
    ownerId: uuid("owner_id"),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "string",
    }).defaultNow(),
  },
  (table) => [
    unique("oauth_clients_client_id_key").on(table.clientId),
    index("idx_oauth_clients_owner").on(table.ownerId),
    foreignKey({
      columns: [table.ownerId],
      foreignColumns: [users.id],
      name: "oauth_clients_owner_id_fkey",
    }).onDelete("cascade"),
  ],
);

/**
 * OAuth 2.1 authorization codes (Phase 2, @tmcp/auth). Short-lived,
 * single-use, PKCE-bound. Survives scale-to-zero because it lives in
 * Postgres, not memory.
 */
export const oauthCodes = pgTable(
  "oauth_codes",
  {
    code: text().primaryKey().notNull(),
    clientId: text("client_id").notNull(),
    redirectUri: text("redirect_uri").notNull(),
    codeChallenge: text("code_challenge"),
    scopes: jsonb().$type<string[]>().notNull().default([]),
    // The account that authorized this code — flows into the issued token.
    userId: uuid("user_id"),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    consumedAt: timestamp("consumed_at", {
      withTimezone: true,
      mode: "date",
    }),
  },
  (table) => [
    index("idx_oauth_codes_client").on(table.clientId),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "oauth_codes_user_id_fkey",
    }).onDelete("cascade"),
  ],
);

/**
 * OAuth 2.1 access + refresh tokens (Phase 2, @tmcp/auth). Opaque random
 * strings stored in Postgres so tokens survive scale-to-zero restarts —
 * web AIs (Grok, ChatGPT, Gemini) don't need to re-authorize after the
 * Fly VM stops and cold-starts.
 */
export const oauthTokens = pgTable(
  "oauth_tokens",
  {
    accessToken: text("access_token").primaryKey().notNull(),
    refreshToken: text("refresh_token").notNull(),
    clientId: text("client_id").notNull(),
    scopes: jsonb().$type<string[]>().notNull().default([]),
    // The account the token belongs to (from the authorization code).
    userId: uuid("user_id"),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    refreshExpiresAt: timestamp("refresh_expires_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    revokedAt: timestamp("revoked_at", {
      withTimezone: true,
      mode: "date",
    }),
  },
  (table) => [
    unique("oauth_tokens_refresh_token_key").on(table.refreshToken),
    index("idx_oauth_tokens_client").on(table.clientId),
    index("idx_oauth_tokens_user").on(table.userId),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "oauth_tokens_user_id_fkey",
    }).onDelete("cascade"),
  ],
);

export const memoryEntityLinks = pgTable(
  "memory_entity_links",
  {
    memoryId: uuid("memory_id").notNull(),
    entityId: uuid("entity_id").notNull(),
  },
  (table) => [
    index("idx_links_entity").using(
      "btree",
      table.entityId.asc().nullsLast().op("uuid_ops"),
    ),
    foreignKey({
      columns: [table.memoryId],
      foreignColumns: [memories.id],
      name: "memory_entity_links_memory_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.entityId],
      foreignColumns: [entities.id],
      name: "memory_entity_links_entity_id_fkey",
    }).onDelete("cascade"),
    primaryKey({
      columns: [table.memoryId, table.entityId],
      name: "memory_entity_links_pkey",
    }),
  ],
);
