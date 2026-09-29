/**
 * Full reindex of memories + entities into OpenSearch.
 *
 *   bun run os:backfill            # upsert everything (idempotent)
 *   bun run os:backfill -- --drop  # drop the index first, then upsert
 *
 * Ids are stable (`_id = kind:id`), so re-running is safe and converges.
 * Requires OPENSEARCH_URL (+ auth) and DATABASE_URL — Bun loads .env itself.
 * The password is read from env only: never printed, never stored, never sent
 * anywhere but the Authorization header.
 */
import { db } from "../packages/shared/src/db/client.ts";
import { entities, memories } from "../packages/shared/src/db/schema.ts";
import {
  bulkIndex,
  ensureIndex,
  opensearchEnabled,
  osIndex,
  osRequest,
} from "../packages/shared/src/db/lib/opensearch-client.ts";
import {
  buildEntityDoc,
  buildMemoryDoc,
  entityRowQuery,
  memoryRowQuery,
} from "../packages/shared/src/db/lib/index-sync.ts";

const BATCH = 500;

if (!opensearchEnabled()) {
  console.error("OPENSEARCH_URL is not set — refusing to backfill.");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set — refusing to backfill.");
  process.exit(1);
}

if (process.argv.includes("--drop")) {
  try {
    await osRequest("DELETE", `/${osIndex()}`);
    console.log(`dropped index ${osIndex()}`);
  } catch (err) {
    // 404 = index didn't exist; anything else is a real failure.
    const status = (err as { status?: number }).status;
    if (status !== 404) throw err;
    console.log(`index ${osIndex()} did not exist — creating fresh`);
  }
}
await ensureIndex();

const conn = db();
const startedAt = Date.now();
let memCount = 0;
let entCount = 0;
let batches = 0;

for (let offset = 0; ; offset += BATCH) {
  const rows = await memoryRowQuery(conn)
    .orderBy(memories.id)
    .limit(BATCH)
    .offset(offset);
  if (!rows.length) break;
  const docs = rows
    .map((r) => buildMemoryDoc(r))
    .filter((d): d is NonNullable<typeof d> => d !== null);
  await bulkIndex(docs);
  memCount += docs.length;
  batches++;
}

for (let offset = 0; ; offset += BATCH) {
  const rows = await entityRowQuery(conn)
    .orderBy(entities.id)
    .limit(BATCH)
    .offset(offset);
  if (!rows.length) break;
  const docs = rows
    .map((r) => buildEntityDoc(r))
    .filter((d): d is NonNullable<typeof d> => d !== null);
  await bulkIndex(docs);
  entCount += docs.length;
  batches++;
}

console.log(
  JSON.stringify({
    index: osIndex(),
    memories: memCount,
    entities: entCount,
    batches,
    ms: Date.now() - startedAt,
  }),
);
