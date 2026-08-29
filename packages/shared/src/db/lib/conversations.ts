import type { Db } from "../client.ts";
import { and, desc, eq, getTableColumns, inArray, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import {
  entities,
  memories,
  memoryEntityLinks,
  namespaces,
} from "../schema.ts";
import { normalizeEntityType, normalizeTags } from "../../types.ts";
import { resolveNamespaceId } from "./util.ts";

export interface ConversationEntityInput {
  name: string;
  type: string;
  summary?: string;
}

/** Lifecycle state of a conversation — which one to resume. */
export const CONVERSATION_STATUSES = ["active", "paused", "done"] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export interface ConversationIngest {
  /** The digest — structured markdown, ≤4000 chars. */
  summary: string;
  /** Groups digests of the same conversation (one per major topic). */
  conversation_id: string;
  /** Human-readable name — how you tell conversations apart when resuming. */
  title?: string;
  /** Lifecycle state: active (resume me) | paused | done. Default active. */
  status?: ConversationStatus;
  decisions?: string[];
  preferences?: string[];
  instructions?: string[];
  observations?: string[];
  open_questions?: string[];
  entities?: ConversationEntityInput[];
  source?: { ai: string; ref?: string };
  transcript?: string;
  namespace?: string;
  tags?: string[];
}

export interface IngestResult {
  digest_id: string;
  conversation_id: string;
  memories_created: number;
  entities_created: number;
  entities_linked: number;
  namespace: string;
}

/** Importance for the digest — high enough that consolidation never touches it. */
export const DIGEST_IMPORTANCE = 0.85;

/** The tag that marks digests — "list my conversations" = search tags=["conversation"]. */
export const CONVERSATION_TAG = "conversation";

/**
 * Ingest a distilled conversation (handoff digest) as an atomic bundle:
 *
 *   digest memory (entry point, tag `conversation`, metadata.kind="conversation")
 *   + constituent memories (decisions→fact, preferences→preference,
 *     instructions→instruction, observations→observation, open_questions→
 *     observation tagged `open-question`), each with metadata.conversation_id
 *   + entities (find-or-create by name in the namespace)
 *
 * All inserts + entity links go through ONE db.batch() — atomic, single
 * Neon HTTP call. The digest is the entry point; constituents are the
 * evidence; metadata.conversation_id groups them; the optional transcript
 * lives in digest metadata (out of search, pure fidelity).
 */
export async function ingestConversation(
  db: Db,
  ownerId: string,
  input: ConversationIngest,
  source?: string,
): Promise<IngestResult> {
  const namespaceName = input.namespace ?? "personal";
  const namespaceId = await resolveNamespaceId(db, ownerId, namespaceName);
  const topicTags = normalizeTags(input.tags);
  const conversationId = input.conversation_id;

  // ── Entities: find-or-create by name (UNIQUE namespace_id + name) ────────
  const entityInputs = input.entities ?? [];
  const entityIds: string[] = [];
  let entitiesCreated = 0;
  if (entityInputs.length) {
    const names = [...new Set(entityInputs.map((e) => e.name))];
    const existing = await db
      .select({ id: entities.id, name: entities.name })
      .from(entities)
      .where(
        and(
          eq(entities.namespaceId, namespaceId),
          inArray(entities.name, names),
        ),
      );
    const byName = new Map(existing.map((e) => [String(e.name), String(e.id)]));
    const missing = entityInputs.filter((e) => !byName.has(e.name));
    if (missing.length) {
      const inserts = missing.map((e) => {
        const { type, tag } = normalizeEntityType(e.type);
        return {
          namespaceId,
          name: e.name,
          type,
          summary: e.summary ?? "",
          tags: tag ? [tag] : [],
        };
      });
      const created = await db
        .insert(entities)
        .values(inserts)
        .onConflictDoNothing({
          target: [entities.namespaceId, entities.name],
        })
        .returning({ id: entities.id, name: entities.name });
      for (const c of created) byName.set(String(c.name), String(c.id));
      entitiesCreated = created.length;
    }
    for (const e of entityInputs) {
      const id = byName.get(e.name);
      if (id) entityIds.push(id);
    }
  }

  // ── Build the bundle: digest + constituents ──────────────────────────────
  const digestId = crypto.randomUUID();
  const digestMetadata: Record<string, unknown> = {
    kind: "conversation",
    conversation_id: conversationId,
    status: input.status ?? "active",
  };
  if (input.title) digestMetadata.title = input.title;
  if (input.source?.ai) digestMetadata.source_ai = input.source.ai;
  if (input.source?.ref) digestMetadata.source_ref = input.source.ref;
  if (input.transcript) digestMetadata.transcript = input.transcript;

  const queries: BatchItem<"pg">[] = [
    db.insert(memories).values({
      id: digestId,
      namespaceId,
      content: input.summary,
      type: "fact",
      importance: DIGEST_IMPORTANCE,
      source: source ?? input.source?.ai ?? null,
      metadata: digestMetadata,
      tags: normalizeTags([...topicTags, CONVERSATION_TAG]),
    }),
  ];

  const constituents: {
    content: string;
    type: "fact" | "observation" | "preference" | "instruction";
    importance: number;
    tags: string[];
  }[] = [
    ...(input.decisions ?? []).map((c) => ({
      content: c,
      type: "fact" as const,
      importance: 0.7,
      tags: [...topicTags, "decision"],
    })),
    ...(input.preferences ?? []).map((c) => ({
      content: c,
      type: "preference" as const,
      importance: 0.7,
      tags: [...topicTags, "preference"],
    })),
    ...(input.instructions ?? []).map((c) => ({
      content: c,
      type: "instruction" as const,
      importance: 0.7,
      tags: [...topicTags, "instruction"],
    })),
    ...(input.observations ?? []).map((c) => ({
      content: c,
      type: "observation" as const,
      importance: 0.5,
      tags: [...topicTags, "observation"],
    })),
    ...(input.open_questions ?? []).map((c) => ({
      content: c,
      type: "observation" as const,
      importance: 0.6,
      tags: [...topicTags, "open-question"],
    })),
  ];

  const linkIds = entityIds.slice(0, 3);
  for (const c of constituents) {
    const id = crypto.randomUUID();
    queries.push(
      db.insert(memories).values({
        id,
        namespaceId,
        content: c.content,
        type: c.type,
        importance: c.importance,
        source: source ?? input.source?.ai ?? null,
        metadata: { kind: "conversation", conversation_id: conversationId },
        tags: normalizeTags(c.tags),
      }),
    );
    for (const entityId of linkIds) {
      queries.push(
        db.insert(memoryEntityLinks).values({ memoryId: id, entityId }),
      );
    }
  }
  for (const entityId of linkIds) {
    queries.push(
      db.insert(memoryEntityLinks).values({ memoryId: digestId, entityId }),
    );
  }

  await db.batch(queries as [BatchItem<"pg">, ...BatchItem<"pg">[]]);

  return {
    digest_id: digestId,
    conversation_id: conversationId,
    memories_created: 1 + constituents.length,
    entities_created: entitiesCreated,
    entities_linked: linkIds.length,
    namespace: namespaceName,
  };
}

/**
 * Fetch every memory of a conversation (digest + constituents) by
 * conversation_id, newest first. Uses jsonb containment on metadata.
 */
export async function getConversation(
  db: Db,
  ownerId: string,
  conversationId: string,
  namespace?: string,
) {
  const conditions = [
    eq(memories.archived, false),
    eq(namespaces.ownerId, ownerId),
    // jsonb_build_object('key', $1) fails in prepared statements (variadic
    // "any" — Postgres can't infer the param type). Use a JSON literal with
    // an explicit ::jsonb cast instead.
    sql`${memories.metadata} @> ${JSON.stringify({ conversation_id: conversationId })}::jsonb`,
  ];
  if (namespace !== undefined) {
    const nsId = await resolveNamespaceId(db, ownerId, namespace);
    conditions.push(eq(memories.namespaceId, nsId));
  }
  return db
    .select({
      ...getTableColumns(memories),
      namespace: namespaces.name,
    })
    .from(memories)
    .innerJoin(namespaces, eq(namespaces.id, memories.namespaceId))
    .where(and(...conditions))
    .orderBy(desc(memories.importance), desc(memories.updatedAt));
}
