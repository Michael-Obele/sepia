import { command, form, query } from '$app/server';
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
import { lines, parseEntities, parseTags, slugify } from './parsers';

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

/**
 * Create or update a memory, as a form — the dialog's Save button is a submit
 * button, so saving works without JavaScript. `id` present → update.
 *
 * The schema is the UI shape (tags arrive as comma-separated text); the
 * shared input schema is re-applied with `v.parse` so nothing loses the
 * validation the old commands guaranteed: tag caps, uuid entity ids, the
 * 4000-char content bound.
 */
export const saveMemory = form(
	v.object({
		id: v.optional(v.string(), ''),
		content: v.pipe(v.string(), v.minLength(1, 'Memory content is required'), v.maxLength(4000)),
		type: v.picklist(['fact', 'observation', 'preference', 'instruction']),
		importance: v.optional(v.pipe(v.number(), v.minValue(0), v.maxValue(1)), 0.5),
		namespace: v.optional(v.string(), 'personal'),
		entity_ids: v.optional(v.array(v.string()), []),
		tags: v.optional(v.string(), '')
	}),
	async ({ id, content, type, importance, namespace, entity_ids, tags }) => {
		const user = await requireAuth();
		const fields = { content, type, importance, entity_ids, tags: parseTags(tags) };
		if (id) {
			return updateMemory(db(), user.id, id, v.parse(MemoryUpdateInput, fields));
		}
		return createMemory(
			db(),
			user.id,
			v.parse(MemoryInput, { ...fields, namespace }),
			'dashboard',
			user.plan
		);
	}
);

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

/**
 * Ingest a distilled conversation (handoff digest bundle) as a form — the
 * dialog's Save button submits it. The schema is the UI shape (textareas of
 * lines, comma tags); `v.parse(ConversationInput, …)` re-applies the shared
 * schema so digests keep exactly the validation the old command gave them.
 */
export const ingestConversationData = form(
	v.object({
		title: v.pipe(
			v.string(),
			v.minLength(1, "Title is required — it's how you tell conversations apart when resuming"),
			v.maxLength(200)
		),
		summary: v.pipe(v.string(), v.minLength(1, 'Summary is required'), v.maxLength(4000)),
		status: v.picklist(['active', 'paused', 'done']),
		conversation_id: v.optional(v.string(), ''),
		decisions: v.optional(v.string(), ''),
		preferences: v.optional(v.string(), ''),
		instructions: v.optional(v.string(), ''),
		observations: v.optional(v.string(), ''),
		open_questions: v.optional(v.string(), ''),
		entities: v.optional(v.string(), ''),
		source_ai: v.optional(v.string(), ''),
		source_ref: v.optional(v.string(), ''),
		tags: v.optional(v.string(), ''),
		namespace: v.optional(v.string(), 'personal')
	}),
	async (data) => {
		const user = await requireAuth();
		const conversation_id = data.conversation_id.trim() || slugify(data.title);
		if (!conversation_id) {
			throw new Error('Conversation ID is required (groups digests of the same conversation)');
		}
		return ingestConversation(
			db(),
			user.id,
			v.parse(ConversationInput, {
				summary: data.summary.trim(),
				title: data.title.trim(),
				status: data.status,
				conversation_id,
				decisions: lines(data.decisions),
				preferences: lines(data.preferences),
				instructions: lines(data.instructions),
				observations: lines(data.observations),
				open_questions: lines(data.open_questions),
				entities: parseEntities(data.entities),
				source: data.source_ai.trim()
					? { ai: data.source_ai.trim(), ref: data.source_ref.trim() || undefined }
					: undefined,
				tags: parseTags(data.tags),
				namespace: data.namespace
			}),
			'dashboard'
		);
	}
);

/** Fetch every memory of a conversation (digest + constituents) by conversation_id. */
export const getConversationData = query(v.string(), async (conversationId) => {
	const user = await requireAuth();
	return getConversation(db(), user.id, conversationId);
});
