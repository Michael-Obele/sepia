import type { McpServer } from "tmcp";
import * as v from "valibot";
import { WakeToolInput } from "@sepia/shared/schemas";
import type { SepiaClient } from "../client.ts";
import { safe, SEPIA_ICON } from "./util.ts";

/**
 * `wake` — the readiness probe, proxied to `GET /api/wake`.
 *
 * Present here for surface parity: the contract tells every model to call
 * `wake` first at the top of a chat, so a client connecting through the npm
 * package must expose it too. Without it the model would get "unknown tool" on
 * its very first call — the exact failure this tool exists to prevent.
 */
export function registerWakeTool(
  server: McpServer<any, any>,
  client: SepiaClient,
) {
  server.tool(
    {
      name: "wake",
      title: "Wake Server",
      description:
        "Confirm the server and its database are up. Call this FIRST at the top of a chat, before the briefing — the remote host sleeps when idle, so the first call of a conversation often lands during boot and a failure here costs nothing to retry. Returns {awake, ready, server:{version, docs_version, uptime_sec}, db:{ok, latency_ms}, next}. Takes no arguments.",
      icons: [SEPIA_ICON],
      schema: WakeToolInput,
      annotations: { readOnlyHint: true },
    },
    safe(WakeToolInput, async (_args: v.InferInput<typeof WakeToolInput>) => {
      const result = await client.wake();
      return {
        ...result,
        hint: "Succeeded → call manage_memory action=briefing next, once, then search on later turns. Failed → retry this up to 3 times a few seconds apart; do not skip the briefing and do not conclude sepia is down from one failed call.",
      };
    }),
  );
}
