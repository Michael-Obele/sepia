import type { McpServer } from "tmcp";
import * as v from "valibot";
import { SearchToolInput } from "@sepia/shared";
import { db } from "../db.ts";
import {
  recordTelemetrySafe,
  resolveSearchEngine,
  search,
  searchOptions,
  summarizeSearch,
} from "@sepia/shared";
import { safe, SEPIA_ICON, telemetrySession } from "./util.ts";

export function registerSearchTools(server: McpServer<any, any>) {
  server.tool(
    {
      name: "search",
      title: "Search Memory",
      description:
        "Unified keyword + metadata search across memories, entity names, and entity summaries. Multi-word queries are best-effort: rows matching more of your words rank first, and results are never emptied by one absent word. `partial: true` means no single row covered the whole query, and `best_matched_terms` reports the best coverage achieved — pass it back as `min_terms` when you want precision instead of recall.",
      icons: [SEPIA_ICON],
      schema: SearchToolInput,
      annotations: { readOnlyHint: true },
    },
    safe(async (args: v.InferInput<typeof SearchToolInput>) => {
      const user = server.ctx.custom?.user;
      if (!user) throw new Error("unauthenticated");
      const startedAt = Date.now();
      const hits = await search(db(), user.id, args);
      const summary = summarizeSearch(args.q, hits);
      recordTelemetrySafe(db(), {
        ownerId: user.id,
        sessionHash: telemetrySession(server.ctx),
        tool: "search",
        // The engine ACTUALLY used, not the one requested: the server default can
        // differ per call, and the A/B compares these values.
        engine: resolveSearchEngine(args),
        terms: summary.terms,
        bestMatchedTerms: summary.best_matched_terms,
        hitCount: hits.length,
        latencyMs: Date.now() - startedAt,
        // What the model actually receives, so cost is measured, not guessed.
        resultChars: hits.reduce((n, h) => n + (h.snippet?.length ?? 0), 0),
        queryText: args.q,
        hitIds: hits.map((h) => h.id),
        // The call AS MADE (limit, precision dial, filters, requested engine) —
        // never `q`, which is content and lives in queryText above.
        options: searchOptions(args),
      });
      return { count: hits.length, ...summary, hits };
    }),
  );
}
