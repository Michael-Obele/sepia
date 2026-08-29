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
import { safe, SEPIA_ICON } from "./util.ts";

export function registerMemoryTools(server: McpServer<any, any>) {
  server.tool(
    {
      name: "manage_memory",
      title: "Manage Memories",
      description:
        "Create, get, update, delete, query, batch-update, or ingest memories — knowledge fragments with importance scoring, plus conversation handoff digests.",
      icons: [SEPIA_ICON],
      schema: MemoryToolInput,
    },
    safe(async (args: v.InferInput<typeof MemoryToolInput>) => {
      const user = server.ctx.custom?.user;
      if (!user) throw new Error("unauthenticated");
      const sql = db();
      switch (args.action) {
        case "create": {
          if (!args.memory) throw new Error("action=create requires memory");
          const source =
            server.ctx.sessionInfo?.clientInfo?.name ?? "unknown-client";
          return {
            action: "create",
            memory: await createMemory(
              sql,
              user.id,
              args.memory,
              source,
              user.plan,
            ),
          };
        }
        case "get": {
          if (!args.id) throw new Error("action=get requires id");
          return {
            action: "get",
            memory: await getMemory(sql, user.id, args.id),
          };
        }
        case "update": {
          if (!args.id) throw new Error("action=update requires id");
          if (!args.update) throw new Error("action=update requires update");
          return {
            action: "update",
            memory: await updateMemory(sql, user.id, args.id, args.update),
          };
        }
        case "delete": {
          if (!args.id) throw new Error("action=delete requires id");
          return {
            action: "delete",
            deleted: await deleteMemory(sql, user.id, args.id),
          };
        }
        case "query": {
          const memories = await queryMemories(sql, user.id, {
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
              user.id,
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
            ...(await ingestConversation(
              sql,
              user.id,
              args.conversation,
              source,
            )),
          };
        }
      }
    }),
  );
}
