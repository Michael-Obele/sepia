/**
 * Telemetry CLI — opt in/out for an account and read what was collected.
 *
 * Telemetry is OFF by default for every account, and the data only ever lives
 * in that account's own Postgres. Nothing is sent to a third party.
 *
 *   bun run scripts/telemetry.ts status
 *   bun run scripts/telemetry.ts on [signals|transcripts]   (default: signals)
 *   bun run scripts/telemetry.ts off
 *   bun run scripts/telemetry.ts summary [days]             (default: 30)
 *   bun run scripts/telemetry.ts events [limit]             (the raw rows, for transparency)
 *   bun run scripts/telemetry.ts purge                      (enforce the TTL now)
 *   bun run scripts/telemetry.ts delete                     (erase every row)
 *
 * Target a different account with `--email you@example.com`.
 */
import { eq, sql } from "drizzle-orm";
import { db } from "../src/db.ts";
import { users } from "@sepia/shared";
import {
  deleteTelemetry,
  getTelemetrySettings,
  listTelemetry,
  purgeExpiredTelemetry,
  setTelemetrySettings,
  telemetrySummary,
  type TelemetryTier,
} from "@sepia/shared";

const conn = db();
const args = process.argv.slice(2);
const action = args[0] ?? "status";
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};

async function resolveOwner(): Promise<string> {
  const email = flag("--email");
  if (email) {
    const rows = await conn
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (!rows[0]) throw new Error(`no user with email ${email}`);
    return String(rows[0].id);
  }
  const rows = await conn.execute(sql`
    SELECT n.owner_id AS owner
      FROM namespaces n JOIN memories m ON m.namespace_id = n.id
     WHERE n.name = 'personal'
     GROUP BY n.owner_id ORDER BY count(m.id)::int DESC LIMIT 1
  `);
  const owner = (rows.rows[0] as { owner: string } | undefined)?.owner;
  if (!owner) throw new Error("no 'personal' namespace found; pass --email");
  return String(owner);
}

const ownerId = await resolveOwner();
const pct = (n: number, of: number) =>
  of === 0 ? "—" : `${((n / of) * 100).toFixed(1)}%`;

switch (action) {
  case "status": {
    const s = await getTelemetrySettings(conn, ownerId);
    console.log(`account ${ownerId}`);
    console.log(`  tier    : ${s.tier}`);
    console.log(`  ttl     : ${s.ttlDays} days (tier-2 payloads only)`);
    console.log(`  since   : ${s.enabledAt ?? "never enabled"}`);
    break;
  }
  case "on": {
    const tier = (args[1] === "transcripts" ? "transcripts" : "signals") as TelemetryTier;
    const s = await setTelemetrySettings(conn, ownerId, { tier, ttlDays: 30 });
    console.log(`telemetry enabled for ${ownerId}: tier=${s.tier}, ttl=${s.ttlDays}d`);
    console.log(
      tier === "transcripts"
        ? "  collecting counters AND raw query text + returned ids (expires in 30 days)"
        : "  collecting counters only (no query text, no content)",
    );
    break;
  }
  case "off": {
    const s = await setTelemetrySettings(conn, ownerId, { tier: "off" });
    console.log(`telemetry disabled for ${ownerId} (tier=${s.tier})`);
    console.log("  existing rows are kept; use `telemetry delete` to erase them");
    break;
  }
  case "delete": {
    console.log(`deleted ${await deleteTelemetry(conn, ownerId)} telemetry rows`);
    break;
  }
  case "purge": {
    console.log(`nulled tier-2 payloads on ${await purgeExpiredTelemetry(conn, ownerId)} rows`);
    break;
  }
  case "events": {
    const rows = await listTelemetry(conn, ownerId, Number(args[1] ?? 25));
    console.log(`${rows.length} most recent events for ${ownerId}`);
    for (const r of rows) {
      console.log(
        `  ${r.createdAt ?? ""}  ${r.tool}/${r.action ?? "-"}  engine=${r.engine ?? "-"}  hits=${r.hitCount ?? "-"}  cov=${r.bestMatchedTerms ?? "-"}/${r.terms ?? "-"}  ${r.latencyMs ?? "-"}ms` +
          (r.queryText ? `  q=${JSON.stringify(r.queryText.slice(0, 60))}` : ""),
      );
    }
    break;
  }
  case "summary": {
    // Enforce retention before reporting, since there is no scheduler.
    await purgeExpiredTelemetry(conn, ownerId);
    const s = await telemetrySummary(conn, ownerId, Number(args[1] ?? 30));
    console.log(`telemetry summary — account ${ownerId}, last ${s.window_days} days`);
    console.log(`  tier ${s.tier}, ttl ${s.ttl_days}d, oldest event ${s.oldest ?? "none"}`);
    console.log(`  events ${s.events}   searches ${s.searches}   distinct queries ${s.distinct_queries}`);
    console.log(
      `  correlated searches ${s.correlated_searches}/${s.searches} (${pct(s.correlated_searches, s.searches)}) — only these can be given an outcome`,
    );
    console.log(
      `  ZERO-RESULT ${s.zero_result} (${pct(s.zero_result, s.searches)})  ← the false-zero bug class`,
    );
    console.log(
      `  REPEATED   ${s.repeated} (${pct(s.repeated, s.correlated_searches)})  ← same query again in a session`,
    );
    console.log(
      `  REFORMULATED ${s.reformulated} (${pct(s.reformulated, s.correlated_searches)})  ← another search within 120s`,
    );
    console.log(`  latency p50 ${s.latency_ms.p50 ?? "—"}ms  p95 ${s.latency_ms.p95 ?? "—"}ms`);
    console.log(`  avg result payload ${s.avg_result_chars ?? "—"} chars`);
    console.log("  by engine:");
    if (!s.by_engine.length) console.log("    (no correlated searches yet)");
    for (const e of s.by_engine)
      console.log(
        `    ${e.engine.padEnd(9)} searches=${e.searches} zero=${e.zero_result} repeated=${e.repeated}`,
      );
    console.log(
      `  briefing: ${s.briefing.calls} calls, ${s.briefing.escalated} escalated to detail=all, ${s.briefing.sessions_started_work_first} session(s) searched/wrote BEFORE ever calling it`,
    );
    break;
  }
  default:
    console.log(`unknown action: ${action}`);
    process.exitCode = 1;
}
