// Remote functions barrel — re-exported individually (not `export *`) for
// better documentation and discovery. Each resolves the signed-in user itself
// via `requireAuth()` and scopes every query to that user's id.

export { getStatsData } from './stats.remote';
export { getNamespaces, addNamespace, removeNamespace } from './namespaces.remote';
export { getEntities, getEntityDetail, saveEntity, removeEntity } from './entities.remote';
export { getBriefingData } from './briefing.remote';
export {
	getMemories,
	getMemoryDetail,
	saveMemory,
	updateMemoryData,
	removeMemory,
	ingestConversationData,
	getConversationData
} from './memories.remote';
export { getRelations, addRelation, removeRelation } from './relations.remote';
export { searchAll } from './search.remote';
export { getGraph, getFullGraph } from './graph.remote';
export { runPruneMemories } from './prune-memories.remote';
export { exportAll } from './export.remote';
export { getMe } from './account.remote';
export { signIn, signUp, signOut, signOutOtherSessions } from './auth.remote';
export { listApiKeys, saveApiKey, regenerateApiKey, deleteApiKey } from './api-keys.remote';
// Billing schema/types live in $lib/billing (a .remote.ts file may only export
// remote functions), but they are re-exported here so callers keep one import.
// `BillingPeriod` is both a valibot schema and a type — one export carries both.
export { createCheckout } from './billing.remote';
export { BillingPeriod, type CheckoutResult } from '$lib/billing';
export { listConnections, disconnectConnection } from './connections.remote';
export {
	getTelemetry,
	getTelemetryReport,
	getTelemetryEvents,
	getTelemetryFailures,
	updateTelemetryTier,
	updateTelemetryTtl,
	eraseTelemetry
} from './telemetry.remote';
