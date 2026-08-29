import type { McpServer } from "tmcp";
import * as v from "valibot";
import { ConsolidateToolInput } from "@sepia/shared";
import { db } from "../db.ts";
import { consolidate } from "@sepia/shared";
import { safe, SEPIA_ICON } from "./util.ts";

export function registerConsolidateTools(server: McpServer<any, any>) {
  server.tool(
    {
      name: "consolidate",
      title: "Consolidate Memory",
      description:
        "Idempotent maintenance sweep — pure SQL, no LLM calls. Scoped to your namespaces only.",
      icons: [SEPIA_ICON],
      schema: ConsolidateToolInput,
      annotations: { destructiveHint: true },
    },
    safe(async () => {
      const user = server.ctx.custom?.user;
      if (!user) throw new Error("unauthenticated");
      return consolidate(db(), user.id);
    }),
  );
}
