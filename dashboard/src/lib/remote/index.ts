// Remote functions barrel — re-exported individually (not `export *`) for
// better documentation and discovery. Each function takes the auth token as
// its first argument and validates it server-side before touching the DB.

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
export { runConsolidate } from './consolidate.remote';
export { exportAll } from './export.remote';
export { getMe } from './account.remote';
export { signIn, signUp } from './auth.remote';
export { listApiKeys, createApiKey, deleteApiKey } from './api-keys.remote';
export { listConnections, disconnectConnection } from './connections.remote';
