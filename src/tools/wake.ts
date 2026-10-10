import type { McpServer } from "tmcp";
import * as v from "valibot";
import { sql } from "drizzle-orm";
import { DOCS_VERSION, WakeToolInput } from "@sepia/shared";
import { db } from "../db.ts";
import { SERVER_VERSION } from "../version.ts";
import { safe, SEPIA_ICON } from "./util.ts";

/**
 * `wake` — the readiness probe, and the only tool whose job is to be retried.
 *
 * WHY IT EXISTS: the Fly Machine sleeps between sessions (fly.toml:
 * auto_stop_machines, min_machines_running = 0). The first call of a
 * conversation can therefore land during boot, and whatever takes that hit
 * looks to the model like "the memory server is down" — which is how a session
 * ends up abandoning memory entirely. So the hit lands here instead.
 *
 * It is NOT what warms the database: `requireAuth` already runs a query on
 * every MCP POST before any handler runs. What this buys is cost asymmetry —
 * a single `select 1` sits in front of `briefing`, the heaviest read in the
 * system (up to BRIEFING_FETCH_MAX rows, compacted, plus namespace
 * resolution). Cheap probe first, expensive read second.
 *
 * Deliberately writes NO telemetry: recordTelemetrySafe would be a second
 * round-trip on the slowest call of the session, for a signal we can already
 * infer from uptime.
 */
export function registerWakeTool(server: McpServer<any, any>) {
  server.tool(
    {
      name: "wake",
      title: "Wake Server",
      description:
        "Confirm the server and its database are up. Call this FIRST at the top of a chat, before the briefing — Sepia's host sleeps when idle, so the first call of a conversation often lands during boot and a failure here costs nothing to retry. Returns {awake, ready, server:{version, docs_version, uptime_sec}, db:{ok, latency_ms}, next}. Takes no arguments.",
      icons: [SEPIA_ICON],
      schema: WakeToolInput,
      annotations: { readOnlyHint: true },
    },
    safe(WakeToolInput, async (_args: v.InferInput<typeof WakeToolInput>) => {
      const started = performance.now();
      try {
        await db().execute(sql`select 1`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // A tool error, not a payload: models retry errors and read payloads
        // as answers, and this one is only ever correct as "try again".
        throw new Error(
          `[wake_not_ready] The server answered but the database did not (${message}). ` +
            `Sepia may still be booting, or Neon may be scaled to zero. ` +
            `Retry wake up to 3 times, a few seconds apart. Then call the briefing. ` +
            `Do NOT skip the briefing, and do NOT conclude sepia is down from one failed call.`,
        );
      }
      const latencyMs = Math.round(performance.now() - started);
      return {
        awake: true,
        ready: true,
        server: {
          version: SERVER_VERSION,
          docs_version: DOCS_VERSION,
          uptime_sec: Math.round(process.uptime()),
        },
        db: { ok: true, latency_ms: latencyMs },
        next: "manage_memory action=briefing — once, at the top of this chat.",
      };
    }),
  );
}
