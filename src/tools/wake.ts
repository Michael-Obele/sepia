import type { McpServer } from "tmcp";
import * as v from "valibot";
import { sql } from "drizzle-orm";
import { DOCS_VERSION, WakeToolInput } from "@sepia/shared";
import { db } from "../db.ts";
import { SERVER_VERSION } from "../version.ts";
import { safe, SEPIA_ICON } from "./util.ts";

/**
 * `wake` — the readiness probe, and the only tool whose job is to be retried. The Fly Machine
 * sleeps between sessions, so a conversation's first call can land during boot and look to the
 * model like "memory is down". It does not warm the DB (`requireAuth` already queries): what it
 * buys is a single `select 1` in front of `briefing`, the heaviest read. No telemetry — a second
 * round trip on the slowest call of the session.
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
