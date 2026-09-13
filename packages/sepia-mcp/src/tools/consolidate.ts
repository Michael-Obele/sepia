import type { McpServer } from "tmcp";
import { ConsolidateToolInput } from "@sepia/shared/schemas";
import type { SepiaClient } from "../client.ts";
import { safe, SEPIA_ICON } from "./util.ts";

export function registerConsolidateTools(
  server: McpServer<any, any>,
  client: SepiaClient,
) {
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
      return (await client.consolidate()).result;
    }),
  );
}
