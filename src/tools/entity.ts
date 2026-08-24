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
import { safe } from "./util.ts";

export function registerEntityTools(server: McpServer<any, any>) {
  server.tool(
    {
      name: "manage_entity",
      description:
        "Create, get, update, delete, find, or batch-update entities — knowledge graph nodes (people, projects, tools, concepts, repos). " +
        "Type is normalized to one of: person, project, tool, concept, repo (unknown → concept + tag). " +
        "Actions: create (entity: {name, type, summary?, importance?, metadata?, tags?}) | get (id — includes linked memories and relations) | " +
        "update (id + update: any subset of name/type/summary/importance/metadata/tags) | delete (id — cascades relations, unlinks memories) | " +
        "find (query, optional type + namespace — up to 10 matches) | " +
        "batch_update (where: {type?, namespace?, query?} — at least one; update: any subset; batch_limit? max 500) — updates ALL matching entities, returns count.",
      schema: EntityToolInput,
    },
    safe(async (args: v.InferInput<typeof EntityToolInput>) => {
      const sql = db();
      switch (args.action) {
        case "create": {
          if (!args.entity) throw new Error("action=create requires entity");
          return {
            action: "create",
            entity: await createEntity(
              sql,
              args.namespace ?? DEFAULT_NAMESPACE,
              args.entity,
            ),
          };
        }
        case "get": {
          if (!args.id) throw new Error("action=get requires id");
          return { action: "get", entity: await getEntity(sql, args.id) };
        }
        case "update": {
          if (!args.id) throw new Error("action=update requires id");
          if (!args.update) throw new Error("action=update requires update");
          return {
            action: "update",
            entity: await updateEntity(sql, args.id, args.update),
          };
        }
        case "delete": {
          if (!args.id) throw new Error("action=delete requires id");
          return {
            action: "delete",
            deleted: await deleteEntity(sql, args.id),
          };
        }
        case "find": {
          const entities = await findEntities(
            sql,
            args.namespace,
            args.query,
            args.type,
          );
          return { action: "find", count: entities.length, entities };
        }
        case "batch_update": {
          if (!args.where) throw new Error("action=batch_update requires where");
          if (!args.update) throw new Error("action=batch_update requires update");
          return {
            action: "batch_update",
            ...(await batchUpdateEntities(
              sql,
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
