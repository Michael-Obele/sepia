import * as v from 'valibot';
import { MEMORY_TYPES, ENTITY_TYPES } from '@sepia/shared/types';
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
 * Memory list views. `briefing` is the standing-rules set, which is a slice of
 * memories (see the design note on `briefing-panel.svelte`) — not its own route.
 * Defaults are omitted from the URL by runed (`showDefaults` is false), so
 * `/app/memories` stays clean and only `?view=briefing` appears.
 */
export const MEMORY_VIEWS = ['all', 'briefing'] as const;
export type MemoryView = (typeof MEMORY_VIEWS)[number];

/** Entity views — the graph is a rendering of the same nodes as the list. */
export const ENTITY_VIEWS = ['list', 'graph'] as const;
export type EntityView = (typeof ENTITY_VIEWS)[number];

/**
 * `/app/memories` filters. Every field has a default so the schema validates
 * an empty URL (`{}`) — runed uses that to derive defaults and type hints.
 * `fallback` covers invalid values (e.g. `?minImportance=abc`), `optional`
 * covers missing ones.
 */
export const memoriesSearchSchema = v.object({
	view: v.optional(v.fallback(v.picklist(MEMORY_VIEWS), 'all'), 'all'),
	q: v.optional(v.fallback(v.string(), ''), ''),
	type: v.optional(v.fallback(v.picklist(MEMORY_TYPE_OPTIONS), 'all'), 'all'),
	namespace: v.optional(v.fallback(v.string(), 'all'), 'all'),
	minImportance: v.optional(v.fallback(v.number(), 0), 0),
	archived: v.optional(v.fallback(v.boolean(), false), false)
});

/** `/app/entities` filters. */
export const entitiesSearchSchema = v.object({
	view: v.optional(v.fallback(v.picklist(ENTITY_VIEWS), 'list'), 'list'),
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
