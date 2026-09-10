import { query, command } from '$app/server';
import * as v from 'valibot';
import {
	queryMemories,
	getMemory,
	createMemory,
	updateMemory,
	deleteMemory,
	ingestConversation,
	getConversation,
	MemoryInput,
	MemoryUpdateInput,
	ConversationInput
} from '@sepia/shared';
import { db } from '$lib/server/db';
import { requireAuth } from '$lib/server/auth';

const MemoryFilters = v.object({
	q: v.optional(v.string()),
	type: v.optional(v.picklist(['fact', 'observation', 'preference', 'instruction'])),
	namespace: v.optional(v.string()),
	importance_min: v.optional(v.number()),
	archived: v.optional(v.boolean(), false),
	tags: v.optional(v.array(v.string())),
	limit: v.optional(v.number(), 20),
	offset: v.optional(v.number(), 0)
});

/** Query memories with filters. */
export const getMemories = query(MemoryFilters, async (filters) => {
	const user = await requireAuth();
	return queryMemories(db(), user.id, filters);
});

/** Full memory detail: memory + linked entities. */
export const getMemoryDetail = query(v.string(), async (id) => {
	const user = await requireAuth();
	return getMemory(db(), user.id, id);
});

/** Create a memory (optionally linked to entities). */
export const addMemory = command(MemoryInput, async (input) => {
	const user = await requireAuth();
	return createMemory(db(), user.id, input, 'dashboard', user.plan);
});

/** Update a memory. */
export const updateMemoryData = command(
	v.tuple([v.string(), MemoryUpdateInput]),
	async ([id, update]) => {
		const user = await requireAuth();
		return updateMemory(db(), user.id, id, update);
	}
);

/** Delete a memory. */
export const removeMemory = command(v.string(), async (id) => {
	const user = await requireAuth();
	return deleteMemory(db(), user.id, id);
});

/** Ingest a distilled conversation (handoff digest bundle). */
export const ingestConversationData = command(ConversationInput, async (input) => {
	const user = await requireAuth();
	return ingestConversation(db(), user.id, input, 'dashboard');
});

/** Fetch every memory of a conversation (digest + constituents) by conversation_id. */
export const getConversationData = query(v.string(), async (conversationId) => {
	const user = await requireAuth();
	return getConversation(db(), user.id, conversationId);
});
