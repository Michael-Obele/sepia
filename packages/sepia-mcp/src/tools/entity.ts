import type { McpServer } from "tmcp";
import * as v from "valibot";
import { EntityToolInput } from "@sepia/shared/schemas";
import type { SepiaClient } from "../client.ts";
import { safe, SEPIA_ICON } from "./util.ts";

export function registerEntityTools(
  server: McpServer<any, any>,
  client: SepiaClient,
) {
  server.tool(
    {
      name: "manage_entity",
      title: "Manage Entities",
      description:
        "Create, get, update, delete, find, or batch-update entities — knowledge graph nodes (people, projects, tools, concepts, repos).",
      icons: [SEPIA_ICON],
      schema: EntityToolInput,
    },
    safe(async (args: v.InferInput<typeof EntityToolInput>) => {
      switch (args.action) {
        case "create": {
          if (!args.entity) throw new Error("action=create requires entity");
          return {
            action: "create",
            entity: await client.createEntity(
              args.namespace ?? "personal",
              args.entity,
            ),
          };
        }
        case "get": {
          if (!args.id) throw new Error("action=get requires id");
          return {
            action: "get",
            entity: await client.getEntity(args.id),
          };
        }
        case "update": {
          if (!args.id) throw new Error("action=update requires id");
          if (!args.update) throw new Error("action=update requires update");
          return {
            action: "update",
            entity: await client.updateEntity(args.id, args.update),
          };
        }
        case "delete": {
          if (!args.id) throw new Error("action=delete requires id");
          return {
            action: "delete",
            deleted: await client.deleteEntity(args.id),
          };
        }
        case "find": {
          const { count, entities } = await client.findEntities({
            namespace: args.namespace,
            q: args.query,
            type: args.type,
          });
          return { action: "find", count, entities };
        }
        case "batch_update": {
          if (!args.where)
            throw new Error("action=batch_update requires where");
          if (!args.update)
            throw new Error("action=batch_update requires update");
          return {
            action: "batch_update",
            ...(await client.batchUpdateEntities(
              args.where,
              args.update,
              args.batch_limit,
            )),
          };
        }
      }
    }),
  );
}
