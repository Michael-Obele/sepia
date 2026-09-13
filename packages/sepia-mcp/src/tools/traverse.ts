import type { McpServer } from "tmcp";
import * as v from "valibot";
import { TraverseToolInput } from "@sepia/shared/schemas";
import type { SepiaClient } from "../client.ts";
import { safe, SEPIA_ICON } from "./util.ts";

export function registerTraverseTools(
  server: McpServer<any, any>,
  client: SepiaClient,
) {
  server.tool(
    {
      name: "traverse_graph",
      title: "Traverse Graph",
      description:
        "BFS-walk the knowledge graph from a start entity (both directions).",
      icons: [SEPIA_ICON],
      schema: TraverseToolInput,
      annotations: { readOnlyHint: true },
    },
    safe(async (args: v.InferInput<typeof TraverseToolInput>) => {
      const graph = await client.traverseGraph(args.start_id, args.depth);
      return {
        start_id: args.start_id,
        ...(graph as Record<string, unknown>),
      };
    }),
  );
}
