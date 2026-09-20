// Remote functions barrel — re-exported individually (not `export *`) for
// better documentation and discovery. Each resolves the signed-in user itself
// via `requireAuth()` and scopes every query to that user's id.

export { getStatsData } from './stats.remote';
export { getNamespaces, addNamespace, removeNamespace } from './namespaces.remote';
export {
	getEntities,
	getEntityDetail,
	addEntity,
	updateEntityData,
	removeEntity
} from './entities.remote';
export {
	getMemories,
	getMemoryDetail,
	addMemory,
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
export { listApiKeys, createApiKey, deleteApiKey } from './api-keys.remote';
export { listConnections, disconnectConnection } from './connections.remote';
export {
	getTelemetry,
	getTelemetryReport,
	getTelemetryEvents,
	updateTelemetryTier,
	eraseTelemetry
} from './telemetry.remote';
