import * as v from 'valibot';
import { MEMORY_TYPES, ENTITY_TYPES } from '@sepia/shared';
import { CONVERSATION_STATUSES } from '$lib/format.js';
import type { SearchParamsOptions } from 'runed/kit';

/**
 * Shared options for dashboard search params (runed `useSearchParams`).
 *
 * - `pushHistory: false` — updates use replaceState, so back/forward isn't
 *   cluttered; the URL always mirrors the current state.
 * - `noScroll: true` — keep scroll position when the URL updates.
 *
 * No debounce: searches only run on Enter/Apply, so URL updates are instant
 * (replaceState) and there's nothing to batch.
 */
export const SEARCH_PARAMS_OPTIONS = {
	pushHistory: false,
	noScroll: true
} satisfies SearchParamsOptions;

const MEMORY_TYPE_OPTIONS = ['all', ...MEMORY_TYPES] as const;
const ENTITY_TYPE_OPTIONS = ['', ...ENTITY_TYPES] as const;
const CONVERSATION_STATUS_OPTIONS = ['all', ...CONVERSATION_STATUSES] as const;

/**
 * `/app/memories` filters. Every field has a default so the schema validates
 * an empty URL (`{}`) — runed uses that to derive defaults and type hints.
 * `fallback` covers invalid values (e.g. `?minImportance=abc`), `optional`
 * covers missing ones.
 */
export const memoriesSearchSchema = v.object({
	q: v.optional(v.fallback(v.string(), ''), ''),
	type: v.optional(v.fallback(v.picklist(MEMORY_TYPE_OPTIONS), 'all'), 'all'),
	namespace: v.optional(v.fallback(v.string(), 'all'), 'all'),
	minImportance: v.optional(v.fallback(v.number(), 0), 0),
	archived: v.optional(v.fallback(v.boolean(), false), false)
});

/** `/app/entities` filters. */
export const entitiesSearchSchema = v.object({
	q: v.optional(v.fallback(v.string(), ''), ''),
	namespace: v.optional(v.fallback(v.string(), 'all'), 'all'),
	type: v.optional(v.fallback(v.picklist(ENTITY_TYPE_OPTIONS), ''), '')
});

/** `/app/conversations` filters. */
export const conversationsSearchSchema = v.object({
	q: v.optional(v.fallback(v.string(), ''), ''),
	status: v.optional(v.fallback(v.picklist(CONVERSATION_STATUS_OPTIONS), 'all'), 'all')
});

/** `/app` unified search. */
export const appSearchSchema = v.object({
	q: v.optional(v.fallback(v.string(), ''), ''),
	namespace: v.optional(v.fallback(v.string(), 'all'), 'all')
});
