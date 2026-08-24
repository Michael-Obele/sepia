import type { McpServer } from "tmcp";
import * as v from "valibot";
import { MemoryToolInput } from "@sepia/shared";
import { db } from "../db.ts";
import {
  batchUpdateMemories,
  createMemory,
  deleteMemory,
  getMemory,
  ingestConversation,
  queryMemories,
  updateMemory,
} from "@sepia/shared";
import { safe } from "./util.ts";

export function registerMemoryTools(server: McpServer<any, any>) {
  server.tool(
    {
      name: "manage_memory",
      description:
        "Create, get, update, delete, query, or batch-update memories — knowledge fragments (facts, observations, preferences, instructions) with importance scoring and optional tags. " +
        "Actions: create (memory: {content, type?, importance?, namespace?, entity_ids? [0-3], metadata?, tags?} — source auto-set to client name) | " +
        "get (id — includes linked entities) | update (id + update — entity_ids REPLACES the link set, tags REPLACES the tag set) | " +
        "delete (id) | query (filters: type, namespace, importance_min, archived, tags; ordered importance DESC, updated_at DESC; limit max 50) | " +
        "batch_update (where: {type?, namespace?, tags?, importance_min?, q?} — at least one; update: any subset; batch_limit? max 500) — updates ALL matching memories, returns count | " +
        "ingest (conversation: {summary ≤4000, conversation_id, title?, status? active|paused|done, decisions?, preferences?, instructions?, observations?, open_questions?, entities?, source? {ai, ref?}, transcript? ≤100k, namespace?, tags?}) — atomically saves a distilled conversation as a digest (tag 'conversation', importance 0.85) + constituent memories + entities. Use when the user says 'save this conversation' or is switching AIs mid-task. One digest per major topic, same conversation_id groups them. Give it a human-readable title and status (active = resume me) so conversations are distinguishable when resuming.",
      schema: MemoryToolInput,
    },
    safe(async (args: v.InferInput<typeof MemoryToolInput>) => {
      const sql = db();
      switch (args.action) {
        case "create": {
          if (!args.memory) throw new Error("action=create requires memory");
          const source =
            server.ctx.sessionInfo?.clientInfo?.name ?? "unknown-client";
          return {
            action: "create",
            memory: await createMemory(sql, args.memory, source),
          };
        }
        case "get": {
          if (!args.id) throw new Error("action=get requires id");
          return { action: "get", memory: await getMemory(sql, args.id) };
        }
        case "update": {
          if (!args.id) throw new Error("action=update requires id");
          if (!args.update) throw new Error("action=update requires update");
          return {
            action: "update",
            memory: await updateMemory(sql, args.id, args.update),
          };
        }
        case "delete": {
          if (!args.id) throw new Error("action=delete requires id");
          return {
            action: "delete",
            deleted: await deleteMemory(sql, args.id),
          };
        }
        case "query": {
          const memories = await queryMemories(sql, {
            type: args.type,
            namespace: args.namespace,
            importance_min: args.importance_min,
            archived: args.archived,
            tags: args.tags,
            limit: args.limit,
          });
          return { action: "query", count: memories.length, memories };
        }
        case "batch_update": {
          if (!args.where)
            throw new Error("action=batch_update requires where");
          if (!args.update)
            throw new Error("action=batch_update requires update");
          return {
            action: "batch_update",
            ...(await batchUpdateMemories(
              sql,
              args.where,
              args.update,
              args.batch_limit,
            )),
          };
        }
        case "ingest": {
          if (!args.conversation) {
            throw new Error("action=ingest requires conversation");
          }
          const source =
            server.ctx.sessionInfo?.clientInfo?.name ?? "unknown-client";
          return {
            action: "ingest",
            ...(await ingestConversation(sql, args.conversation, source)),
          };
        }
      }
    }),
  );
}
