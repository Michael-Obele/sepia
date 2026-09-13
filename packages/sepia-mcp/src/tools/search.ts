import type { McpServer } from "tmcp";
import * as v from "valibot";
import { SearchToolInput } from "@sepia/shared/schemas";
import type { SepiaClient } from "../client.ts";
import { safe, SEPIA_ICON } from "./util.ts";

export function registerSearchTools(
  server: McpServer<any, any>,
  client: SepiaClient,
) {
  server.tool(
    {
      name: "search",
      title: "Search Memory",
      description:
        "Unified keyword + metadata search across memories, entity names, and entity summaries.",
      icons: [SEPIA_ICON],
      schema: SearchToolInput,
      annotations: { readOnlyHint: true },
    },
    safe(async (args: v.InferInput<typeof SearchToolInput>) => {
      const { count, results } = await client.search({
        q: args.q,
        namespace: args.namespace,
        type: args.type,
        tags: args.tags,
        limit: args.limit,
      });
      return { count, hits: results };
    }),
  );
}
