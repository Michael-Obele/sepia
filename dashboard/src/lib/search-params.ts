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
 * `/app/memories` LIST filters. The briefing is its own route
 * (`/app/briefing`), so this carries no `view` param.
 *
 * Every field has a default so the schema validates an empty URL (`{}`) —
 * runed uses that to derive defaults and type hints. `fallback` covers invalid
 * values (e.g. `?minImportance=abc`), `optional` covers missing ones.
 */
export const memoriesSearchSchema = v.object({
	q: v.optional(v.fallback(v.string(), ''), ''),
	type: v.optional(v.fallback(v.picklist(MEMORY_TYPE_OPTIONS), 'all'), 'all'),
	namespace: v.optional(v.fallback(v.string(), 'all'), 'all'),
	minImportance: v.optional(v.fallback(v.number(), 0), 0),
	archived: v.optional(v.fallback(v.boolean(), false), false)
});

/**
 * `/app/briefing` — the standing-rules slice of memories, as its own route. It
 * carries only the namespace filter; the text/type/importance filters are
 * list-only and do not apply to it.
 */
export const briefingSearchSchema = v.object({
	namespace: v.optional(v.fallback(v.string(), 'all'), 'all')
});

/**
 * `/app/entities` filters — the LIST view. The graph is its own route
 * (`/app/graph`), so its `focus` param lives in `graphSearchSchema` below and
 * never has to survive a tab switch through this page's URL.
 */
export const entitiesSearchSchema = v.object({
	q: v.optional(v.fallback(v.string(), ''), ''),
	namespace: v.optional(v.fallback(v.string(), 'all'), 'all'),
	type: v.optional(v.fallback(v.picklist(ENTITY_TYPE_OPTIONS), ''), '')
});

/**
 * `/app/graph` — `focus` is the entity id to centre on. It rides on the
 * graph's OWN url, so an entity detail page links straight to
 * `/app/graph?focus=<id>` and the id arrives intact (a fixed-path redirect
 * would have discarded it).
 */
export const graphSearchSchema = v.object({
	focus: v.optional(v.fallback(v.string(), ''), '')
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
