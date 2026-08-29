import type { McpServer } from "tmcp";
import * as v from "valibot";
import { SearchToolInput } from "@sepia/shared";
import { db } from "../db.ts";
import { search } from "@sepia/shared";
import { safe, SEPIA_ICON } from "./util.ts";

export function registerSearchTools(server: McpServer<any, any>) {
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
      const user = server.ctx.custom?.user;
      if (!user) throw new Error("unauthenticated");
      const hits = await search(db(), user.id, args);
      return { count: hits.length, hits };
    }),
  );
}
