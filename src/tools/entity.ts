import type { McpServer } from "tmcp";
import * as v from "valibot";
import { DEFAULT_NAMESPACE, EntityToolInput } from "@sepia/shared";
import { db } from "../db.ts";
import {
  batchUpdateEntities,
  createEntity,
  deleteEntity,
  findEntities,
  getEntity,
  updateEntity,
} from "@sepia/shared";
import { safe, SEPIA_ICON } from "./util.ts";

export function registerEntityTools(server: McpServer<any, any>) {
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
      const user = server.ctx.custom?.user;
      if (!user) throw new Error("unauthenticated");
      const sql = db();
      switch (args.action) {
        case "create": {
          if (!args.entity) throw new Error("action=create requires entity");
          return {
            action: "create",
            entity: await createEntity(
              sql,
              user.id,
              args.namespace ?? DEFAULT_NAMESPACE,
              args.entity,
            ),
          };
        }
        case "get": {
          if (!args.id) throw new Error("action=get requires id");
          return {
            action: "get",
            entity: await getEntity(sql, user.id, args.id),
          };
        }
        case "update": {
          if (!args.id) throw new Error("action=update requires id");
          if (!args.update) throw new Error("action=update requires update");
          return {
            action: "update",
            entity: await updateEntity(sql, user.id, args.id, args.update),
          };
        }
        case "delete": {
          if (!args.id) throw new Error("action=delete requires id");
          return {
            action: "delete",
            deleted: await deleteEntity(sql, user.id, args.id),
          };
        }
        case "find": {
          const entities = await findEntities(
            sql,
            user.id,
            args.namespace,
            args.query,
            args.type,
          );
          return { action: "find", count: entities.length, entities };
        }
        case "batch_update": {
          if (!args.where)
            throw new Error("action=batch_update requires where");
          if (!args.update)
            throw new Error("action=batch_update requires update");
          return {
            action: "batch_update",
            ...(await batchUpdateEntities(
              sql,
              user.id,
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
