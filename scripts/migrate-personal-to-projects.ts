/**
 * Splits the `personal` namespace into per-project namespaces.
 *
 * DRY RUN BY DEFAULT. Nothing is written, moved or deleted unless `--apply` is
 * passed, and even then nothing is deleted: every move is a `namespace_id`
 * change, reversible by pointing it back.
 *
 * The rule that decides a row's destination:
 *   1. A memory tagged `always` STAYS in `personal`, whatever else is true. The
 *      tag means "applies in every repo and every session", and a universal rule
 *      filed under one project stops loading in the others — a behavior
 *      regression dressed as tidying.
 *   2. Otherwise, follow its entity links to entities of type `project`.
 *      - exactly one project  → that project's namespace (created on apply)
 *      - several projects     → the highest-importance one, REPORTED for review
 *      - none                 → stays in `personal`
 *
 * Run:
 *   bun run scripts/migrate-personal-to-projects.ts          # report only
 *   bun run scripts/migrate-personal-to-projects.ts --apply  # execute
 *
 * Env: DATABASE_URL (loaded from .env by Bun), and `MIGRATE_OWNER_EMAIL` to pick
 * the account when the database holds more than one.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@sepia/shared";
import {
  entities,
  memoryEntityLinks,
  memories,
  namespaces,
  users,
} from "@sepia/shared";
import { DEFAULT_NAMESPACE } from "@sepia/shared/types";
import { ALWAYS_TAG } from "@sepia/shared/types";

const APPLY = process.argv.includes("--apply");
const OWNER_EMAIL = process.env.MIGRATE_OWNER_EMAIL;

/** `personal` bucket name → the slug we would create. Repo slugs are slugs. */
const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

interface Row {
  memoryId: string;
  content: string;
  projects: { id: string; name: string; importance: number | null }[];
  always: boolean;
}

async function main() {
  const sqlDb = db();

  const owners = await sqlDb
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(
      OWNER_EMAIL ? eq(users.email, OWNER_EMAIL) : sql`true`,
    );
  if (owners.length !== 1) {
    console.error(
      `expected exactly one owner, found ${owners.length}. Set MIGRATE_OWNER_EMAIL to choose one:`,
    );
    for (const o of owners) console.error(`  ${o.email}`);
    process.exit(1);
  }
  const owner = owners[0]!;
  console.log(`owner: ${owner.email}`);

  const [personal] = await sqlDb
    .select()
    .from(namespaces)
    .where(
      and(
        eq(namespaces.ownerId, owner.id),
        eq(namespaces.name, DEFAULT_NAMESPACE),
      ),
    );
  if (!personal) {
    console.log(`no '${DEFAULT_NAMESPACE}' namespace — nothing to do.`);
    return;
  }

  // Every memory in personal, plus the projects it is linked to. One query, so
  // the report and the apply cannot disagree about what was seen.
  const rows = (await sqlDb.execute(sql`
    SELECT m.id            AS memory_id,
           m.content       AS content,
           m.tags          AS tags,
           COALESCE(
             json_agg(json_build_object(
               'id', e.id, 'name', e.name, 'importance', e.importance
             )) FILTER (WHERE e.id IS NOT NULL),
             '[]'
           ) AS projects
    FROM memories m
    LEFT JOIN memory_entity_links l ON l.memory_id = m.id
    LEFT JOIN entities e ON e.id = l.entity_id AND e.type = 'project'
    WHERE m.namespace_id = ${personal.id}
    GROUP BY m.id, m.content, m.tags
  `)) as unknown as {
    rows: { memory_id: string; content: string; tags: string[]; projects: unknown }[];
  };

  const parsed: Row[] = rows.rows.map((r) => ({
    memoryId: r.memory_id,
    content: r.content,
    tags: r.tags ?? [],
    always: (r.tags ?? []).includes(ALWAYS_TAG),
    projects: r.projects as Row["projects"],
  }));

  const moves = new Map<string, string[]>();
  const ambiguous: { memoryId: string; content: string; candidates: string[] }[] =
    [];
  const unresolved: string[] = [];
  const curated: { memoryId: string; content: string }[] = [];

  for (const row of parsed) {
    if (row.always) {
      // Curation signal, not a move: a rule tagged universal that names exactly
      // one project is the biggest single source of briefing noise.
      if (row.projects.length === 1) {
        curated.push({ memoryId: row.memoryId, content: row.content });
      }
      continue;
    }
    if (row.projects.length === 0) {
      unresolved.push(row.memoryId);
      continue;
    }
    const sorted = [...row.projects].sort(
      (a, b) => (b.importance ?? 0) - (a.importance ?? 0),
    );
    if (sorted.length > 1) {
      ambiguous.push({
        memoryId: row.memoryId,
        content: row.content,
        candidates: sorted.map((p) => p.name),
      });
    }
    const target = slug(sorted[0]!.name);
    moves.set(target, [...(moves.get(target) ?? []), row.memoryId]);
  }

  const movedTotal = [...moves.values()].reduce((n, ids) => n + ids.length, 0);

  console.log(`\nmemories in '${DEFAULT_NAMESPACE}': ${parsed.length}`);
  console.log(`would move: ${movedTotal}   stays: ${parsed.length - movedTotal}`);

  console.log("\nnamespace                 rows");
  console.log("─".repeat(40));
  for (const [ns, ids] of [...moves.entries()].sort(
    (a, b) => b[1].length - a[1].length,
  )) {
    console.log(`${ns.padEnd(25)} ${String(ids.length).padStart(4)}`);
  }

  if (ambiguous.length) {
    console.log(
      `\nAMBIGUOUS — linked to more than one project (${ambiguous.length}), assigned to the highest-importance one:`,
    );
    for (const a of ambiguous.slice(0, 20)) {
      console.log(`  · ${a.candidates.join(" / ")} → ${a.content.slice(0, 70)}`);
    }
    if (ambiguous.length > 20) console.log(`  … and ${ambiguous.length - 20} more`);
  }

  if (curated.length) {
    console.log(
      `\nTAGGED 'always' BUT NAMES ONE PROJECT (${curated.length}) — left in place.`,
    );
    console.log(
      "  These load in every session and matter in one repo. Consider removing the tag and moving them:",
    );
    for (const c of curated.slice(0, 20)) {
      console.log(`  · ${c.content.slice(0, 90)}`);
    }
    if (curated.length > 20) console.log(`  … and ${curated.length - 20} more`);
  }

  if (!APPLY) {
    console.log("\nDRY RUN — nothing written. Re-run with --apply to execute.");
    console.log(
      `unlinked, staying in '${DEFAULT_NAMESPACE}': ${unresolved.length}`,
    );
    return;
  }

  // ── Apply ────────────────────────────────────────────────────────────────
  let created = 0;
  for (const [name, ids] of moves) {
    const [existing] = await sqlDb
      .select({ id: namespaces.id })
      .from(namespaces)
      .where(and(eq(namespaces.ownerId, owner.id), eq(namespaces.name, name)))
      .limit(1);
    let nsId = existing?.id;
    if (!nsId) {
      const [row] = await sqlDb
        .insert(namespaces)
        .values({
          ownerId: owner.id,
          name,
          description: `Project namespace (split out of ${DEFAULT_NAMESPACE})`,
        })
        .onConflictDoNothing()
        .returning({ id: namespaces.id });
      nsId = row?.id;
      if (nsId) created += 1;
    }
    if (!nsId) {
      console.error(`could not resolve namespace '${name}' — skipping ${ids.length} rows`);
      continue;
    }
    await sqlDb
      .update(memories)
      .set({ namespaceId: nsId })
      .where(inArray(memories.id, ids));
  }

  console.log(`\nAPPLIED. namespaces created: ${created}. rows moved: ${movedTotal}.`);
  console.log("Nothing was deleted. Reversing a move is one update back to 'personal'.");
}

await main();
