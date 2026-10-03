import { entities, memories } from "../schema.ts";

/**
 * The columns the dashboard LIST views actually render — and nothing else.
 *
 * Deliberately excludes the generated BM25 columns (`haystack_tsv` /
 * `content_tsv`). The schema describes them as "only ever read by [Postgres]",
 * and no app code reads them, yet `getTableColumns()` drags them into every
 * `select *`. Measured 2026-10-02: `haystack_tsv` is **45 kB of an 86 kB**
 * 50-row entity payload, worth ~250 ms on the list query (562 ms → 320 ms).
 * `metadata` is excluded from the entity list too (1.1 kB — small, but the card
 * never shows it), and `namespace` from the entity list (the card doesn't
 * render it; the memories card does, so that one keeps it).
 *
 * The MCP, REST and export surfaces keep the FULL row — see `findEntities` /
 * `queryMemories`. Those legitimately expose `metadata` and `access_count`, and
 * changing their output would change the MCP contract.
 */
export const ENTITY_LIST_COLUMNS = {
  id: entities.id,
  name: entities.name,
  type: entities.type,
  summary: entities.summary,
  importance: entities.importance,
  tags: entities.tags,
  updatedAt: entities.updatedAt,
} as const;

export const MEMORY_LIST_COLUMNS = {
  id: memories.id,
  content: memories.content,
  type: memories.type,
  importance: memories.importance,
  tags: memories.tags,
  archived: memories.archived,
  updatedAt: memories.updatedAt,
} as const;

/**
 * Conversation digests need a little more than the plain list: the digest's
 * title, `conversation_id`, status and source AI all live in `metadata`, and the
 * card also shows `source`. Still excludes the generated tsvector.
 */
export const MEMORY_DIGEST_COLUMNS = {
  ...MEMORY_LIST_COLUMNS,
  metadata: memories.metadata,
  source: memories.source,
} as const;
