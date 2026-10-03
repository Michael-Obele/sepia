/**
 * Sibling views of one dataset — the tab sets shared by the routes that show
 * them.
 *
 * These are REAL ROUTES, not a `?view=` query param. Each view is its own page
 * that renders the tab bar and its own content, which means:
 *
 * - the URL alone says which view you are in, so a deep link, a bookmark, or
 *   the back button all work without any client-side tab state;
 * - the tab bar is a set of links, so middle-click and "open in new tab" work;
 * - a param that belongs to ONE view (`?focus=<id>` on the graph) rides on
 *   that view's own URL instead of being rewritten away by a tab switch.
 *
 * Before this, `/app/graph` and `/app/briefing` were 308 redirects onto
 * `/app/entities?view=graph` and `/app/memories?view=briefing`. A redirect to a
 * fixed path DISCARDS the query string, so `?focus=` could never survive the
 * hop — the same defect that once took the Lemon Squeezy `?checkout=success`
 * verification with it.
 */

export type SectionTab = { href: string; label: string };

/** `/app/entities` (list) and `/app/graph` (force-directed). */
export const entityTabs: SectionTab[] = [
	{ href: '/app/entities', label: 'List' },
	{ href: '/app/graph', label: 'Graph' }
];

/** `/app/memories` (everything) and `/app/briefing` (the standing rules). */
export const memoryTabs: SectionTab[] = [
	{ href: '/app/memories', label: 'All' },
	{ href: '/app/briefing', label: 'Briefing' }
];
