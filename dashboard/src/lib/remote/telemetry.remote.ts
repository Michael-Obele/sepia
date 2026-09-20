import { command, query } from '$app/server';
import * as v from 'valibot';
import {
	TELEMETRY_TIERS,
	deleteTelemetry,
	getTelemetrySettings,
	listTelemetry,
	purgeExpiredTelemetry,
	setTelemetrySettings,
	telemetrySummary
} from '@sepia/shared';
import { requireAuth } from '$lib/server/auth';
import { db } from '$lib/server/db';

/** How far back the summary looks. */
const WINDOW_DAYS = 30;

/**
 * The account's telemetry settings. A missing row means OFF — that is the whole
 * default, so this never has to invent a fallback.
 */
export const getTelemetry = query(async () => {
	const user = await requireAuth();
	return getTelemetrySettings(db(), user.id);
});

/**
 * Aggregates for the summary. Enforces the retention window first: this app has
 * no scheduler (the Fly machine scales to zero), so reading is the only moment
 * we can be sure expired payloads actually go.
 */
export const getTelemetryReport = query(async () => {
	const user = await requireAuth();
	const sql = db();
	await purgeExpiredTelemetry(sql, user.id);
	return telemetrySummary(sql, user.id, WINDOW_DAYS);
});

/** The raw rows, so the owner can read exactly what is stored. */
export const getTelemetryEvents = query(v.optional(v.number(), 100), async (limit) => {
	const user = await requireAuth();
	return listTelemetry(db(), user.id, limit);
});

/** Change the tier, including turning it off. */
export const updateTelemetryTier = command(
	v.object({
		tier: v.picklist([...TELEMETRY_TIERS]),
		ttlDays: v.optional(v.number())
	}),
	async ({ tier, ttlDays }) => {
		const user = await requireAuth();
		return setTelemetrySettings(db(), user.id, { tier, ttlDays });
	}
);

/** Erase every telemetry row for this account. */
export const eraseTelemetry = command(async () => {
	const user = await requireAuth();
	return deleteTelemetry(db(), user.id);
});
