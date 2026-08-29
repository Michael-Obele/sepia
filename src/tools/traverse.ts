import type { McpServer } from "tmcp";
import * as v from "valibot";
import { TraverseToolInput } from "@sepia/shared";
import { db } from "../db.ts";
import { traverseGraph } from "@sepia/shared";
import { safe, SEPIA_ICON } from "./util.ts";

export function registerTraverseTools(server: McpServer<any, any>) {
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
      const user = server.ctx.custom?.user;
      if (!user) throw new Error("unauthenticated");
      const graph = await traverseGraph(
        db(),
        user.id,
        args.start_id,
        args.depth,
      );
      return {
        start_id: args.start_id,
        ...graph,
      };
    }),
  );
}
