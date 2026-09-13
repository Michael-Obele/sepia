import type { McpServer } from "tmcp";
import * as v from "valibot";
import { RelationToolInput } from "@sepia/shared/schemas";
import type { SepiaClient } from "../client.ts";
import { safe, SEPIA_ICON } from "./util.ts";

export function registerRelationTools(
  server: McpServer<any, any>,
  client: SepiaClient,
) {
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
      switch (args.action) {
        case "create": {
          if (!args.relation)
            throw new Error("action=create requires relation");
          return {
            action: "create",
            relation: await client.createRelation(args.relation),
          };
        }
        case "delete": {
          if (!args.id) throw new Error("action=delete requires id");
          return {
            action: "delete",
            deleted: await client.deleteRelation(args.id),
          };
        }
        case "list":
          return {
            action: "list",
            relations: (
              await client.listRelations({
                entity_id: args.entity_id,
                namespace: args.namespace,
              })
            ).relations,
          };
      }
    }),
  );
}
