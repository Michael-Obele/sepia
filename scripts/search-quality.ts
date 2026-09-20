/**
 * Search quality measurement — recall and ranking against the REAL corpus.
 *
 * This is the instrument the gap analysis said was missing: it answers "did this
 * change help?" with live data instead of synthetic fixtures. Read-only, safe to
 * run any time.
 *
 * It deliberately does NOT create or drop anything. The BM25 columns and indexes
 * are owned by migration `0010`, so a `teardown` here would be a trap — it would
 * drop objects the schema owns and leave the database drifted from `schema.ts`.
 *
 *   bun run scripts/search-quality.ts recall           # can we still find things?
 *   bun run scripts/search-quality.ts rank "<query>"   # how does BM25 order it?
 */
import { neon } from "@neondatabase/serverless";
import { db } from "../src/db.ts";
import { search } from "@sepia/shared";

const sql = neon(process.env.DATABASE_URL!);
const conn = db();
const action = process.argv[2] ?? "recall";
const short = (s: string, n = 72) => (s ?? "").replace(/\s+/g, " ").slice(0, n);

async function owner(): Promise<string> {
  // Plain neon query rather than drizzle's `execute`: this file holds both
  // clients and their `sql` tags are not interchangeable.
  const rows = (await sql`
    SELECT n.owner_id AS owner FROM namespaces n JOIN memories m ON m.namespace_id = n.id
     WHERE n.name = 'personal' GROUP BY n.owner_id ORDER BY count(m.id)::int DESC LIMIT 1
  `) as Array<{ owner: string }>;
  const o = rows[0]?.owner;
  if (!o) throw new Error("no 'personal' namespace found");
  return String(o);
}

if (action === "recall") {
  // The recall question that decided the design: plain stemmed tokens lose
  // prefixes and compound words; prefix-aware tsquery (`term:*`) recovers them.
  const probes = [
    "migr",
    "migration",
    "classif",
    "classifier",
    "svelte",
    "sveltekit",
    "showcase",
    "bunx",
    "effing",
  ];
  console.log("   probe           ILIKE   tokens   prefix:*   prefix%ofILIKE");
  for (const p of probes) {
    const like = (await sql`
      SELECT count(*)::int AS n FROM memories WHERE content ILIKE ${"%" + p + "%"}
    `) as Array<{ n: number }>;
    const tok = (await sql`
      SELECT count(*)::int AS n FROM memories WHERE content_tsv @@ to_tsquery('english', ${p})
    `) as Array<{ n: number }>;
    const pre = (await sql`
      SELECT count(*)::int AS n FROM memories WHERE content_tsv @@ to_tsquery('english', ${p + ":*"})
    `) as Array<{ n: number }>;
    const pct = Math.round((pre[0]!.n / Math.max(like[0]!.n, 1)) * 100);
    console.log(
      `   ${p.padEnd(14)} ${String(like[0]!.n).padStart(6)} ${String(tok[0]!.n).padStart(8)} ${String(pre[0]!.n).padStart(10)}   ${String(pct).padStart(3)}%`,
    );
  }
  console.log(
    "\n  prefix:* is the recall story: it matches any lexeme STARTING WITH the term,\n" +
      "  so `svelte:*` also finds `SvelteKit`. The residual gap is INFIX matching only.\n" +
      "  ⚠ watch for over-matching where the english stemmer shortens first (effing → eff:*).",
  );
} else if (action === "rank") {
  // Exercises the REAL code path for both engines, so this measures what ships
  // rather than a re-implementation of it.
  const queries = process.argv.slice(3).length
    ? process.argv.slice(3)
    : [
        "gap analysis roadmap curation memory",
        "download size before install",
        "migr",
        "svelte runes",
      ];
  const id = await owner();
  for (const q of queries) {
    const [cov, bm] = await Promise.all([
      search(conn, id, { q, namespace: "personal", limit: 3 }),
      search(conn, id, { q, namespace: "personal", limit: 3, engine: "bm25" }),
    ]);
    console.log(`\n──── ${JSON.stringify(q)}`);
    console.log(`  coverage: ${cov.length} hits`);
    for (const h of cov)
      console.log(`     ${String(h.score).padStart(6)}  ${short(h.content ?? h.name ?? "")}`);
    console.log(`  bm25    : ${bm.length} hits`);
    for (const h of bm)
      console.log(`     ${String(h.score).padStart(6)}  ${short(h.content ?? h.name ?? "")}`);
    console.log(
      `  top hit: ${cov[0] && cov[0].id === bm[0]?.id ? "SAME" : "DIFFERENT"}`,
    );
  }
} else {
  console.log(`unknown action: ${action} (use recall | rank)`);
  process.exitCode = 1;
}
