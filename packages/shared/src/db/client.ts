import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { installFetchRetry } from "./retry.ts";
import * as schema from "./schema.ts";

/**
 * Drizzle client. Type-safe query builder + `sql` template tag (parameterized,
 * no injection surface) + `db.batch()` for atomic multi-writes in one Neon
 * HTTP round trip. Schema (./schema.ts) is the single source of truth for the
 * MCP server, the REST API, and the dashboard.
 *
 * Every client installed here also carries the pre-send retry from `./retry.ts`,
 * so a DNS/connect blip costs one request attempt instead of the whole call
 * (2026-11-14: a 1-second resolver failure surfaced as an HTML 500).
 */
export type Db = NeonHttpDatabase<typeof schema>;

let cached: Db | null = null;

/**
 * Lazy Drizzle client — protocol-only ops work without DATABASE_URL.
 * Accepts an explicit URL (e.g. from SvelteKit's $env/dynamic/private) and
 * falls back to process.env.DATABASE_URL.
 */
export function db(url?: string): Db {
  if (cached) return cached;
  const resolved = url ?? process.env.DATABASE_URL;
  if (!resolved) {
    throw new Error(
      "DATABASE_URL is not set — add it to .env (see .env.example) or run: fly secrets set DATABASE_URL=...",
    );
  }
  // Before the client is created: the retry sits on the driver's GLOBAL fetch
  // hook, so it has to be in place for the client to pick it up.
  installFetchRetry();
  const client = neon(resolved);
  cached = drizzle({ client, schema });
  return cached;
}
