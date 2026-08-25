import type { McpServer } from "tmcp";
import * as v from "valibot";
import { SearchToolInput } from "@sepia/shared";
import { db } from "../db.ts";
import { search } from "@sepia/shared";
import { safe } from "./util.ts";

export function registerSearchTools(server: McpServer<any, any>) {
  server.tool(
    {
      name: "search",
      description:
        "Unified keyword + metadata search across memories, entity names, and entity summaries. " +
        "Input: q (required; empty string returns recent items), namespace?, type? (memory type OR entity type), tags? (match ALL), limit? (max 25). " +
        "Multi-word q = AND-of-words (every word must appear, any order); exact-phrase matches rank first. " +
        "Ranked: exact word match > substring match, then importance, then recency. Returns merged, de-duplicated hits with kind (memory|entity), id, snippet, score.",
      schema: SearchToolInput,
      annotations: { readOnlyHint: true },
    },
    safe(async (args: v.InferInput<typeof SearchToolInput>) => {
      const hits = await search(db(), args);
      return { count: hits.length, hits };
    }),
  );
}
