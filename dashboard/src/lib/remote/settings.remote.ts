import { query } from '$app/server';
import {
	buildStats,
	listTelemetryQuery,
	namespacesQuery,
	purgeExpiredTelemetry,
	statsQueries,
	telemetryFailuresQuery,
	telemetrySettingsQuery,
	telemetrySummary,
	type NamespaceStats,
	type TelemetryTier
} from '@sepia/shared';
import { db } from '$lib/server/db';
import { requireAuth } from '$lib/server/auth';

/** How far back the telemetry summary looks. Mirrors `telemetry.remote.ts`. */
const WINDOW_DAYS = 30;

/** How many rows the two transparency cards show. */
const EVENT_ROWS = 50;
const FAILURE_ROWS = 25;

export interface PreferencesPage {
	namespaces: NamespaceStats[];
	settings: { tier: TelemetryTier; ttlDays: number; enabledAt: string | null };
}

/**
 * Everything `/app/settings/preferences` needs for its first paint, in ONE Neon
 * HTTP round trip: the namespace list plus the telemetry setting.
 *
 * These were two separate remote calls, so the page paid two serverless
 * invocations and two session lookups before it could render either card.
 */
export const getPreferencesPage = query(async (): Promise<PreferencesPage> => {
	const user = await requireAuth();
	const sql = db();
	const [ns, settingRows] = await sql.batch([
		namespacesQuery(sql, user.id),
		telemetrySettingsQuery(sql, user.id)
	]);
	const row = settingRows[0];
	return {
		namespaces: ns.rows as unknown as NamespaceStats[],
		settings: {
			// No row means the account has never opted in. Default is OFF, by design.
			tier: (row?.tier ?? 'off') as TelemetryTier,
			ttlDays: row?.ttlDays ?? 30,
			enabledAt: row?.enabledAt ?? null
		}
	};
});

/**
 * Everything `/app/settings/data` renders, from ONE serverless invocation
 * instead of four.
 *
 * The purge runs FIRST and on its own: retention is enforced on READ (this app
 * has no scheduler — the Fly machine scales to zero), so it has to land before
 * the summary is computed. After it, the dashboard stats, the raw rows and the
 * failure queue all go in ONE Neon HTTP round trip.
 *
 * `telemetrySummary` is deliberately NOT in that batch — it is a multi-statement
 * read of its own (per-engine totals, latency percentiles, …), so folding it in
 * would mean reimplementing it here.
 */
export const getDataPage = query(async () => {
	const user = await requireAuth();
	const sql = db();
	await purgeExpiredTelemetry(sql, user.id);
	const [events, failures, ...statsRows] = await sql.batch([
		listTelemetryQuery(sql, user.id, EVENT_ROWS),
		telemetryFailuresQuery(sql, user.id, WINDOW_DAYS, FAILURE_ROWS),
		...statsQueries(sql, user.id)
	]);
	return {
		stats: buildStats(statsRows),
		events,
		failures,
		report: await telemetrySummary(sql, user.id, WINDOW_DAYS)
	};
});
