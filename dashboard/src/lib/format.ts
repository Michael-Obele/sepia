import type { MemoryType } from '@sepia/shared';

/** Format an ISO timestamp for display. */
export function formatDate(iso: string | null | undefined): string {
	if (!iso) return '—';
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return '—';
	return d.toLocaleString(undefined, {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
		hour: 'numeric',
		minute: '2-digit'
	});
}

/** Relative time like "3h ago" / "2d ago". */
export function timeAgo(iso: string | null | undefined): string {
	if (!iso) return '—';
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return '—';
	const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
	if (seconds < 60) return 'just now';
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	if (days < 30) return `${days}d ago`;
	const months = Math.floor(days / 30);
	if (months < 12) return `${months}mo ago`;
	return `${Math.floor(months / 12)}y ago`;
}

/** Importance as a 0-100 percentage for display. */
export function importancePct(importance: number | null | undefined): number {
	return Math.round((importance ?? 0.5) * 100);
}

/** Tailwind badge classes per memory type. */
export const TYPE_BADGE: Record<MemoryType, string> = {
	fact: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
	observation: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300',
	preference: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
	instruction: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
};

/** Tailwind badge classes per entity type (fallback for unknown types). */
export function entityTypeBadge(type: string): string {
	const map: Record<string, string> = {
		person: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300',
		project: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
		tool: 'bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300',
		concept: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300',
		repo: 'bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200'
	};
	return map[type] ?? 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300';
}

/** Truncate long text with an ellipsis. */
export function truncate(text: string, max = 160): string {
	const t = text.trim().replace(/\s+/g, ' ');
	return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Tailwind badge classes per source AI (conversation digests). */
export function sourceBadge(ai: string | null | undefined): string {
	const map: Record<string, string> = {
		'claude-code': 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300',
		'claude-desktop': 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300',
		copilot: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
		'github-copilot': 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
		codex: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-950 dark:text-cyan-300',
		chatgpt: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
		grok: 'bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200',
		gemini: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
		dashboard: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300'
	};
	const key = (ai ?? '').toLowerCase();
	return map[key] ?? 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300';
}

/** Extract the source AI from a memory row (source column or metadata.source_ai). */
export function sourceAi(m: { source?: string | null; metadata?: unknown }): string {
	const meta = m.metadata as Record<string, unknown> | null | undefined;
	if (typeof meta?.source_ai === 'string' && meta.source_ai) return meta.source_ai;
	return m.source ?? 'unknown';
}

/** Extract the source ref (session path / share URL) from digest metadata. */
export function sourceRef(m: { metadata?: unknown }): string {
	const meta = m.metadata as Record<string, unknown> | null | undefined;
	return typeof meta?.source_ref === 'string' ? meta.source_ref : '';
}

/** Conversation statuses with display labels. */
export const CONVERSATION_STATUSES = ['active', 'paused', 'done'] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

/** Tailwind badge classes per conversation status. */
export function statusBadge(status: string): string {
	const map: Record<string, string> = {
		active: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
		paused: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
		done: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
	};
	return map[status] ?? map.active;
}

/** Extract the conversation status from digest metadata (default active). */
export function conversationStatus(m: { metadata?: unknown }): ConversationStatus {
	const meta = m.metadata as Record<string, unknown> | null | undefined;
	const s = typeof meta?.status === 'string' ? meta.status : 'active';
	return (CONVERSATION_STATUSES as readonly string[]).includes(s)
		? (s as ConversationStatus)
		: 'active';
}

/**
 * Human-readable conversation title. Fallback chain:
 * metadata.title → first `# ` heading in the digest content → conversation_id.
 */
export function conversationTitle(m: {
	metadata?: unknown;
	content?: string | null;
}): string {
	const meta = m.metadata as Record<string, unknown> | null | undefined;
	if (typeof meta?.title === 'string' && meta.title.trim()) return meta.title.trim();
	const firstLine = String(m.content ?? '').split('\n')[0]?.trim() ?? '';
	const heading = firstLine.match(/^#\s+(.+)$/)?.[1];
	if (heading) return heading.trim();
	if (typeof meta?.conversation_id === 'string' && meta.conversation_id) {
		return meta.conversation_id;
	}
	return 'Untitled conversation';
}
