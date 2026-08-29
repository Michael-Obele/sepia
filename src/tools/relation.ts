import type { McpServer } from "tmcp";
import * as v from "valibot";
import { RelationToolInput } from "@sepia/shared";
import { db } from "../db.ts";
import { createRelation, deleteRelation, listRelations } from "@sepia/shared";
import { safe, SEPIA_ICON } from "./util.ts";

export function registerRelationTools(server: McpServer<any, any>) {
  server.tool(
    {
      name: "manage_relation",
      title: "Manage Relations",
      description:
        "Create, delete, or list relations — directed, weighted edges between entities.",
      icons: [SEPIA_ICON],
      schema: RelationToolInput,
    },
    safe(async (args: v.InferInput<typeof RelationToolInput>) => {
      const user = server.ctx.custom?.user;
      if (!user) throw new Error("unauthenticated");
      const sql = db();
      switch (args.action) {
        case "create": {
          if (!args.relation)
            throw new Error("action=create requires relation");
          return {
            action: "create",
            relation: await createRelation(sql, user.id, args.relation),
          };
        }
        case "delete": {
          if (!args.id) throw new Error("action=delete requires id");
          return {
            action: "delete",
            deleted: await deleteRelation(sql, user.id, args.id),
          };
        }
        case "list":
          return {
            action: "list",
            relations: await listRelations(sql, user.id, {
              entity_id: args.entity_id,
              namespace: args.namespace,
            }),
          };
      }
    }),
  );
}
