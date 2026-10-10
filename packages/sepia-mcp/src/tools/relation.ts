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
        "Create, delete, list, or traverse relations — directed, weighted edges between entities. `traverse` BFS-walks the graph from an entity in both directions.",
      icons: [SEPIA_ICON],
      schema: RelationToolInput,
    },
    safe(
      RelationToolInput,
      async (args: v.InferInput<typeof RelationToolInput>) => {
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
                  limit: args.limit,
                  offset: args.offset,
                })
              ).relations,
            };
          case "traverse": {
            if (!args.start_id)
              throw new Error("action=traverse requires start_id");
            const graph = await client.traverseGraph(args.start_id, args.depth);
            return {
              action: "traverse",
              start_id: args.start_id,
              ...(graph as Record<string, unknown>),
            };
          }
        }
      },
    ),
  );
}
