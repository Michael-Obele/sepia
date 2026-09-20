import type { McpServer } from "tmcp";
import * as v from "valibot";
import { MemoryToolInput } from "@sepia/shared/schemas";
import type { SepiaClient } from "../client.ts";
import { safe, SEPIA_ICON } from "./util.ts";

export function registerMemoryTools(
  server: McpServer<any, any>,
  client: SepiaClient,
) {
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
      switch (args.action) {
        case "create": {
          if (!args.memory) throw new Error("action=create requires memory");
          return {
            action: "create",
            memory: await client.createMemory(args.memory),
          };
        }
        case "get": {
          if (!args.id) throw new Error("action=get requires id");
          return {
            action: "get",
            memory: await client.getMemory(args.id),
          };
        }
        case "update": {
          if (!args.id) throw new Error("action=update requires id");
          if (!args.update) throw new Error("action=update requires update");
          return {
            action: "update",
            memory: await client.updateMemory(args.id, args.update),
          };
        }
        case "delete": {
          if (!args.id) throw new Error("action=delete requires id");
          return {
            action: "delete",
            deleted: await client.deleteMemory(args.id),
          };
        }
        case "query": {
          const { count, memories } = await client.queryMemories({
            type: args.type,
            namespace: args.namespace,
            importance_min: args.importance_min,
            archived: args.archived,
            tags: args.tags,
            limit: args.limit,
          });
          return { action: "query", count, memories };
        }
        case "briefing": {
          return {
            action: "briefing",
            ...(await client.getBriefing({
              namespace: args.namespace,
              detail: args.detail,
              max_chars: args.max_chars,
            })),
          };
        }
        case "batch_update": {
          if (!args.where)
            throw new Error("action=batch_update requires where");
          if (!args.update)
            throw new Error("action=batch_update requires update");
          return {
            action: "batch_update",
            ...(await client.batchUpdateMemories(
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
          return {
            action: "ingest",
            ...(await client.ingestConversation(args.conversation)),
          };
        }
      }
    }),
  );
}
