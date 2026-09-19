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
        "Unified keyword + metadata search across memories, entity names, and entity summaries. Multi-word queries are best-effort: rows matching more of your words rank first, and results are never emptied by one absent word. `partial: true` in the result means no single row covered the whole query.",
      icons: [SEPIA_ICON],
      schema: SearchToolInput,
      annotations: { readOnlyHint: true },
    },
    safe(async (args: v.InferInput<typeof SearchToolInput>) => {
      const { count, results, terms, partial } = await client.search({
        q: args.q,
        namespace: args.namespace,
        type: args.type,
        tags: args.tags,
        limit: args.limit,
      });
      return { count, terms, partial, hits: results };
    }),
  );
}
