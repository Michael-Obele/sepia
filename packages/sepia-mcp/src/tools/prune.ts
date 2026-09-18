import type { McpServer } from "tmcp";
import { PruneMemoriesToolInput } from "@sepia/shared/schemas";
import type { SepiaClient } from "../client.ts";
import { safe, SEPIA_ICON } from "./util.ts";

export function registerPruneMemoriesTools(
  server: McpServer<any, any>,
  client: SepiaClient,
) {
  server.tool(
    {
      name: "prune_memories",
      title: "Maintenance sweep — NOT for saving memories",
      description:
        'Maintenance sweep — NOT for saving memories. Never call this to store, remember, or persist anything (that is manage_memory), and never call it proactively or to "tidy up". Run it ONLY when the user explicitly asks to prune or clean up their memories. Destructive and not reversible: archives stale memories (importance < 0.3, untouched 90 days), de-duplicates identical content, and permanently deletes rows archived more than 30 days ago.',
      icons: [SEPIA_ICON],
      schema: PruneMemoriesToolInput,
      annotations: { destructiveHint: true },
    },
    safe(async () => {
      return (await client.pruneMemories()).result;
    }),
  );
}
