import { entities, memories } from "../schema.ts";

/**
 * Only the columns the dashboard LIST views render. The generated BM25 columns are excluded:
 * no app code reads them, but `getTableColumns()` drags them into every select — measured
 * 2026-10-02, `haystack_tsv` was 45kB of an 86kB 50-row payload, ~250ms (562ms → 320ms).
 * MCP/REST/export keep the full row; changing that would change the MCP contract.
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
