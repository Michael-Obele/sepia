import { createHash } from "node:crypto";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { Db } from "../client.ts";
import {
  TELEMETRY_TIERS,
  telemetryEvents,
  telemetrySettings,
} from "../schema.ts";

export type TelemetryTier = (typeof TELEMETRY_TIERS)[number];

/** How long a query's terms are remembered, in seconds, when spotting loops. */
const REFORMULATION_WINDOW_SEC = 120;
/** Settings change rarely; cache so the hot path stays one insert. */
const TIER_CACHE_MS = 30_000;

const tierCache = new Map<
  string,
  { tier: TelemetryTier; ttlDays: number; at: number }
>();

/**
 * Salted, day-scoped fingerprint of a query's terms.
 *
 * The point is to group equivalent queries WITHOUT storing the query. Two
 * consequences worth stating plainly:
 *  - the salt rotates daily, so the same query hashes differently tomorrow —
 *    you cannot profile a user's questions across days, but you also cannot
 *    count "the same query over a week". In-session loops are what matter here.
 *  - the secret falls back to the auth secret (always present) rather than a
 *    literal, because a hardcoded salt makes the hash dictionary-reversible.
 */
export function fingerprintQuery(parts: string[]): string {
  const normalized = [...new Set(parts.map((p) => p.toLowerCase()))]
    .sort()
    .join(" ");
  const day = new Date().toISOString().slice(0, 10);
  const secret =
    process.env.TELEMETRY_SALT ?? process.env.BETTER_AUTH_SECRET ?? "";
  return createHash("sha256")
    .update(`${secret}|${day}|${normalized}`)
    .digest("hex")
    .slice(0, 32);
}

/** Same derivation for sessions: correlated within a day, not across days. */
export function fingerprintSession(parts: string[]): string {
  return fingerprintQuery(["session", ...parts]);
}

export interface TelemetryInput {
  ownerId: string;
  sessionHash?: string | null;
  tool: string;
  action?: string | null;
  engine?: string | null;
  terms?: string[] | null;
  bestMatchedTerms?: number | null;
  hitCount?: number | null;
  latencyMs?: number | null;
  resultChars?: number | null;
  /** tier "transcripts" only — dropped at every other tier */
  queryText?: string | null;
  /** tier "transcripts" only — dropped at every other tier */
  hitIds?: string[] | null;
}

export async function getTelemetrySettings(db: Db, ownerId: string) {
  const rows = await db
    .select()
    .from(telemetrySettings)
    .where(eq(telemetrySettings.ownerId, ownerId))
    .limit(1);
  const row = rows[0];
  return {
    // No row means the account has never opted in. Default is OFF, by design.
    tier: (row?.tier ?? "off") as TelemetryTier,
    ttlDays: row?.ttlDays ?? 30,
    enabledAt: row?.enabledAt ?? null,
  };
}

export async function setTelemetrySettings(
  db: Db,
  ownerId: string,
  input: { tier: TelemetryTier; ttlDays?: number },
) {
  const ttlDays = Math.min(Math.max(input.ttlDays ?? 30, 1), 365);
  const enabledAt = input.tier === "off" ? null : new Date().toISOString();
  await db
    .insert(telemetrySettings)
    .values({ ownerId, tier: input.tier, ttlDays, enabledAt })
    .onConflictDoUpdate({
      target: telemetrySettings.ownerId,
      set: { tier: input.tier, ttlDays, enabledAt, updatedAt: sql`now()` },
    });
  tierCache.delete(ownerId);
  return { tier: input.tier, ttlDays, enabledAt };
}

async function resolveTier(db: Db, ownerId: string) {
  const cached = tierCache.get(ownerId);
  if (cached && Date.now() - cached.at < TIER_CACHE_MS) return cached;
  const settings = await getTelemetrySettings(db, ownerId);
  const entry = { ...settings, at: Date.now() };
  tierCache.set(ownerId, entry);
  return entry;
}

/**
 * Record one event. Never throws at the caller: telemetry that breaks a tool
 * call is worse than no telemetry.
 */
export async function recordTelemetry(
  db: Db,
  input: TelemetryInput,
): Promise<void> {
  const settings = await resolveTier(db, input.ownerId);
  if (settings.tier === "off") return;
  const tier2 = settings.tier === "transcripts";
  await db.insert(telemetryEvents).values({
    ownerId: input.ownerId,
    sessionHash: input.sessionHash ?? null,
    tool: input.tool,
    action: input.action ?? null,
    engine: input.engine ?? null,
    queryFingerprint: input.terms?.length
      ? fingerprintQuery(input.terms)
      : null,
    terms: input.terms?.length ?? null,
    bestMatchedTerms: input.bestMatchedTerms ?? null,
    hitCount: input.hitCount ?? null,
    latencyMs: input.latencyMs ?? null,
    resultChars: input.resultChars ?? null,
    queryText: tier2 ? (input.queryText ?? null) : null,
    hitIds: tier2 ? (input.hitIds ?? null) : null,
  });
}

/**
 * Fire-and-forget wrapper for the request path.
 *
 * Deliberately NOT awaited: an extra round trip on every search is exactly the
 * cost we spent the last change removing. A dropped event is acceptable.
 */
export function recordTelemetrySafe(db: Db, input: TelemetryInput): void {
  void recordTelemetry(db, input).catch(() => {
    /* telemetry must never surface an error to the caller */
  });
}

/**
 * Enforce retention on the tier-2 payloads. There is no scheduler in this app
 * (Fly scales to zero), so this runs on read — call it before showing data,
 * rather than pretending a cron exists.
 */
export async function purgeExpiredTelemetry(db: Db, ownerId?: string) {
  // A correlated FROM keeps this one statement; volumes here are tiny.
  const res = await db.execute(sql`
    UPDATE ${telemetryEvents} e
       SET query_text = NULL, hit_ids = NULL
      FROM ${telemetrySettings} s
     WHERE s.owner_id = e.owner_id
       AND (e.query_text IS NOT NULL OR e.hit_ids IS NOT NULL)
       AND e.created_at < now() - (s.ttl_days * interval '1 day')
       ${ownerId ? sql`AND e.owner_id = ${ownerId}` : sql``}
  `);
  return Number(res.rowCount ?? 0);
}

export interface TelemetrySummary {
  window_days: number;
  tier: TelemetryTier;
  ttl_days: number;
  events: number;
  searches: number;
  /** searches with a session hash — the only ones an outcome can be derived for */
  correlated_searches: number;
  zero_result: number;
  repeated: number;
  reformulated: number;
  distinct_queries: number;
  by_engine: Array<{
    engine: string;
    searches: number;
    zero_result: number;
    repeated: number;
  }>;
  briefing: {
    calls: number;
    escalated: number;
    sessions_started_work_first: number;
  };
  latency_ms: { p50: number | null; p95: number | null };
  avg_result_chars: number | null;
  oldest: string | null;
}

/** The aggregates that answer the questions telemetry exists for. */
export async function telemetrySummary(
  db: Db,
  ownerId: string,
  windowDays = 30,
): Promise<TelemetrySummary> {
  const settings = await getTelemetrySettings(db, ownerId);
  const window = sql`now() - (${windowDays} * interval '1 day')`;

  const totals = await db.execute(sql`
    SELECT
      count(*)::int AS events,
      count(*) FILTER (WHERE tool = 'search')::int AS searches,
      count(*) FILTER (WHERE tool = 'search' AND session_hash IS NOT NULL)::int
        AS correlated_searches,
      count(*) FILTER (WHERE tool = 'search' AND terms > 0 AND hit_count = 0)::int
        AS zero_result,
      count(DISTINCT query_fingerprint)::int AS distinct_queries,
      percentile_disc(0.5) WITHIN GROUP (ORDER BY latency_ms) AS p50,
      percentile_disc(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95,
      avg(result_chars)::int AS avg_chars,
      min(created_at) AS oldest
      FROM ${telemetryEvents}
     WHERE owner_id = ${ownerId} AND created_at > ${window}
  `);
  const t = (totals.rows[0] ?? {}) as Record<string, unknown>;

  // Loop detection: a repeated fingerprint, or any follow-up search inside the
  // reformulation window, within the same session. Both are "that didn't work"
  // signals that need no knowledge of the result content.
  const loops = await db.execute(sql`
    WITH s AS (
      SELECT session_hash, query_fingerprint, engine, hit_count, terms, created_at,
             LEAD(created_at) OVER w AS next_at,
             LEAD(query_fingerprint) OVER w AS next_fp
        FROM ${telemetryEvents}
       WHERE owner_id = ${ownerId} AND tool = 'search'
         AND session_hash IS NOT NULL AND created_at > ${window}
      WINDOW w AS (PARTITION BY session_hash ORDER BY created_at)
    )
    SELECT
      count(*) FILTER (WHERE next_fp = query_fingerprint)::int AS repeated,
      count(*) FILTER (
        WHERE next_at IS NOT NULL
          AND next_at - created_at < (${REFORMULATION_WINDOW_SEC} * interval '1 second')
      )::int AS reformulated
      FROM s
  `);
  const l = (loops.rows[0] ?? {}) as Record<string, unknown>;

  const engines = await db.execute(sql`
    WITH s AS (
      SELECT engine, hit_count, terms, session_hash, query_fingerprint, created_at,
             LEAD(query_fingerprint) OVER w AS next_fp
        FROM ${telemetryEvents}
       WHERE owner_id = ${ownerId} AND tool = 'search' AND session_hash IS NOT NULL
         AND created_at > ${window}
      WINDOW w AS (PARTITION BY session_hash ORDER BY created_at)
    )
    SELECT COALESCE(engine, 'unknown') AS engine,
           count(*)::int AS searches,
           count(*) FILTER (WHERE terms > 0 AND hit_count = 0)::int AS zero_result,
           count(*) FILTER (WHERE next_fp = query_fingerprint)::int AS repeated
      FROM s GROUP BY 1 ORDER BY 2 DESC
  `);

  const brief = await db.execute(sql`
    WITH sess AS (
      SELECT session_hash,
             bool_or(tool = 'manage_memory' AND action = 'briefing') AS called,
             bool_or(
               (tool = 'search')
               OR (tool = 'manage_memory' AND action IN ('create','update','batch_update','ingest'))
             ) AS worked
        FROM ${telemetryEvents}
       WHERE owner_id = ${ownerId} AND session_hash IS NOT NULL AND created_at > ${window}
       GROUP BY session_hash
    )
    SELECT
      (SELECT count(*) FROM ${telemetryEvents}
        WHERE owner_id = ${ownerId} AND action = 'briefing' AND created_at > ${window})::int AS calls,
      (SELECT count(*) FROM ${telemetryEvents}
        WHERE owner_id = ${ownerId} AND action = 'briefing' AND engine = 'all'
          AND created_at > ${window})::int AS escalated,
      count(*) FILTER (WHERE worked AND NOT called)::int AS worked_first
      FROM sess
  `);
  const b = (brief.rows[0] ?? {}) as Record<string, unknown>;

  const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
  const numOrNull = (v: unknown): number | null =>
    v === null || v === undefined ? null : Number(v);

  return {
    window_days: windowDays,
    tier: settings.tier,
    ttl_days: settings.ttlDays,
    events: num(t.events),
    searches: num(t.searches),
    correlated_searches: num(t.correlated_searches),
    zero_result: num(t.zero_result),
    repeated: num(l.repeated),
    reformulated: num(l.reformulated),
    distinct_queries: num(t.distinct_queries),
    by_engine: (engines.rows as Array<Record<string, unknown>>).map((r) => ({
      engine: String(r.engine),
      searches: num(r.searches),
      zero_result: num(r.zero_result),
      repeated: num(r.repeated),
    })),
    briefing: {
      calls: num(b.calls),
      escalated: num(b.escalated),
      sessions_started_work_first: num(b.worked_first),
    },
    latency_ms: { p50: numOrNull(t.p50), p95: numOrNull(t.p95) },
    avg_result_chars: numOrNull(t.avg_chars),
    oldest: t.oldest ? String(t.oldest) : null,
  };
}

/** Raw rows for the transparency viewer — the owner sees exactly what is stored. */
export async function listTelemetry(
  db: Db,
  ownerId: string,
  limit = 100,
) {
  const safeLimit = Math.min(Math.max(limit, 1), 500);
  return db
    .select()
    .from(telemetryEvents)
    .where(eq(telemetryEvents.ownerId, ownerId))
    .orderBy(desc(telemetryEvents.createdAt))
    .limit(safeLimit);
}

/** Right to erasure, in one call. */
export async function deleteTelemetry(db: Db, ownerId: string) {
  const res = await db
    .delete(telemetryEvents)
    .where(eq(telemetryEvents.ownerId, ownerId));
  return res.rowCount ?? 0;
}

/** Searches that came back empty or thin — the queue of real failures to learn from. */
export async function telemetryFailures(
  db: Db,
  ownerId: string,
  windowDays = 30,
  limit = 50,
) {
  return db
    .select()
    .from(telemetryEvents)
    .where(
      and(
        eq(telemetryEvents.ownerId, ownerId),
        eq(telemetryEvents.tool, "search"),
        gte(telemetryEvents.createdAt, sql`now() - (${windowDays} * interval '1 day')`),
        sql`(${telemetryEvents.hitCount} = 0 OR ${telemetryEvents.bestMatchedTerms} < ${telemetryEvents.terms})`,
      ),
    )
    .orderBy(desc(telemetryEvents.createdAt))
    .limit(Math.min(Math.max(limit, 1), 500));
}
