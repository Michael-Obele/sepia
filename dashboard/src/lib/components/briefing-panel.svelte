<script lang="ts">
	import { Plus, Pencil, Trash2, Archive, ChevronUp, ChevronDown } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Card, CardContent, CardHeader } from '$lib/components/ui/card/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { toast } from 'svelte-sonner';
	import {
		getBriefingData,
		getMemoryDetail,
		updateMemoryData,
		removeMemory
	} from '$lib/remote/index.js';
	import { fresh } from '$lib/fresh.js';
	import { importancePct, TYPE_BADGE } from '$lib/format.js';
	import MemoryFormDialog from '$lib/components/memory-form-dialog.svelte';
	import ConfirmDeleteDialog from '$lib/components/confirm-delete-dialog.svelte';
	import { ALWAYS_TAG, CORE_IMPORTANCE, BRIEFING_ITEM_CHARS } from '@sepia/shared/types';
	import { untrack } from 'svelte';

	/**
	 * The standing rules, as an AI reads them.
	 *
	 * WHY this is not `getMemories({ tags: ['always'] })`: core membership is
	 * the `always` tag ALONE, but the briefing also contains the TAIL —
	 * `instruction`/`preference` rows that carry no tag. Filtering on the tag
	 * returns exactly the core set and silently hides the tail, so the
	 * "core vs tail" distinction this panel exists to show could not be drawn.
	 * `getBriefing` is the one query whose predicate IS the briefing, so the
	 * counts, the cost, and the membership badges all come from the same
	 * source the MCP tool reads.
	 */
	let {
		namespace = 'all',
		namespaceList = []
	}: {
		/** Mirrors the list's namespace filter — `'all'` means every namespace. */
		namespace?: string;
		/** Known namespace names, for the create dialog's picker. */
		namespaceList?: string[];
	} = $props();

	type Briefing = Awaited<ReturnType<typeof getBriefingData>>;
	let briefing = $state.raw<Briefing | null>(null);
	let loading = $state(true);
	let error = $state('');
	// "Show all" opt-out: the AI's one-shot escalation is budget-limited, the browser isn't.
	let showAll = $state(false);

	// Guard against out-of-order responses when the namespace changes mid-flight.
	let loadSeq = 0;

	async function load() {
		const seq = ++loadSeq;
		loading = true;
		error = '';
		try {
			// fresh(): query() memoizes same-args calls — without refresh() this
			// would re-await the pre-mutation result and never show our own writes.
			const b = await fresh(
				getBriefingData({
					namespace: namespace === 'all' ? undefined : namespace,
					detail: 'all',
					// Conditional spread keeps the payload identical when budgeted, so the
					// default view stays the AI's exact budget-limited slice (and stays cached).
					...(showAll ? { budget: false } : {})
				})
			);
			if (seq !== loadSeq) return;
			briefing = b;
		} catch (e) {
			if (seq !== loadSeq) return;
			error = (e as Error)?.message ?? 'Failed to load the briefing';
		} finally {
			if (seq === loadSeq) loading = false;
		}
	}

	/**
	 * Reload whenever the namespace filter changes.
	 *
	 * `untrack` matters here: `load()` reads `showAll` synchronously, so
	 * without it the effect would depend on `showAll` too — and the "Show
	 * all" button sets that flag AND calls `load()` itself, which would fire
	 * the request twice. Only the namespace filter is meant to auto-reload;
	 * every other path calls `load()` explicitly.
	 */
	$effect(() => {
		void namespace;
		untrack(() => void load());
	});

	/** ≈ tokens the default (core) briefing costs — chars ÷ 4, deliberately rough. */
	const approxTokens = $derived.by(() => {
		const core = briefing?.memories.filter((m) => m.core) ?? [];
		const chars = core.reduce((n, m) => n + m.content.length, 0);
		return Math.round(chars / 4);
	});

	/** Was this rule cut to the 400-char briefing cap? */
	const isCompacted = (content: string) =>
		content.length >= BRIEFING_ITEM_CHARS && content.endsWith('…');

	// --- mutations -----------------------------------------------------------

	let showForm = $state(false);
	let formMemory = $state<Record<string, unknown> | null>(null);

	/** Open the editor with the FULL row — the list only carries compacted text. */
	async function openEdit(item: { id: string }) {
		try {
			const d = await fresh(getMemoryDetail(String(item.id)));
			formMemory = {
				id: d.id,
				content: d.content,
				type: d.type,
				importance: d.importance,
				namespace: d.namespace,
				tags: d.tags,
				entity_ids: d.entities.map((e) => String(e.id))
			};
			showForm = true;
		} catch (e) {
			toast.error((e as Error)?.message ?? 'Could not load this rule');
		}
	}

	/** New rule, prefilled to land in core: the `always` tag IS membership. No `id` → dialog creates. */
	function openCreate() {
		formMemory = {
			content: '',
			type: 'instruction',
			importance: CORE_IMPORTANCE,
			namespace: namespace !== 'all' ? namespace : (namespaceList[0] ?? 'personal'),
			tags: [ALWAYS_TAG],
			entity_ids: []
		};
		showForm = true;
	}

	async function archive(item: { id: string }) {
		await updateMemoryData([String(item.id), { archived: true }]);
		toast.success('Rule archived — it left the briefing');
		void load();
	}

	let pendingDelete = $state<{
		title: string;
		description: string;
		run: () => void | Promise<void>;
	} | null>(null);

	async function del(id: string) {
		try {
			await removeMemory(String(id));
			toast.success('Rule deleted');
		} finally {
			// Refresh even on failure so a stale card (row already gone) reconciles.
			void load();
		}
	}

	// --- promote / demote: importance IS the rank (membership is the `always` tag) ------

	/** One click steps the rank by 5%; the tag decides core, this decides order. */
	function nextImportance(imp: number, dir: 'up' | 'down'): number {
		const r = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 100) / 100;
		if (dir === 'up') {
			if (imp < CORE_IMPORTANCE) return CORE_IMPORTANCE;
			return r(imp + 0.05);
		}
		if (imp > CORE_IMPORTANCE) return CORE_IMPORTANCE;
		return r(imp - 0.05);
	}

	async function promote(m: { id: string; importance: number | null }) {
		const imp = m.importance ?? 0.5;
		const next = nextImportance(imp, 'up');
		if (next === imp) {
			toast.info('Already at 100%');
			return;
		}
		await updateMemoryData([String(m.id), { importance: next }]);
		toast.success(`Promoted to ${Math.round(next * 100)}%`);
		void load();
	}

	async function demote(m: { id: string; importance: number | null; tags: string[] | null }) {
		const imp = m.importance ?? 0.5;
		const next = nextImportance(imp, 'down');
		if (next === imp) {
			toast.info('Already at 0%');
			return;
		}
		const tagged = m.tags?.includes(ALWAYS_TAG) ?? false;
		await updateMemoryData([String(m.id), { importance: next }]);
		if (tagged) {
			toast.warning(
				`Rank ${Math.round(next * 100)}% — still core; remove the \`always\` tag to take it out of the briefing`
			);
		} else {
			toast.success(`Demoted to ${Math.round(next * 100)}%`);
		}
		void load();
	}
</script>

<div class="space-y-3">
	{#if loading && !briefing}
		<Skeleton class="h-24 w-full" />
		<Skeleton class="h-24 w-full" />
	{:else if error}
		<Card>
			<CardContent class="space-y-3 py-6">
				<p class="text-sm text-destructive">Failed to load the briefing: {error}</p>
				<Button variant="outline" onclick={() => void load()}>Try again</Button>
			</CardContent>
		</Card>
	{:else if briefing}
		<!-- Stats strip -->
		<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
			<div class="rounded-lg border p-3">
				<p class="text-xs text-muted-foreground">Core rules</p>
				<p class="text-lg font-semibold">{briefing.core_count}</p>
			</div>
			<div class="rounded-lg border p-3">
				<p class="text-xs text-muted-foreground">Tail (situational)</p>
				<p class="text-lg font-semibold">{briefing.other_standing}</p>
			</div>
			<div class="rounded-lg border p-3">
				<p class="text-xs text-muted-foreground">Showing</p>
				<p class="text-lg font-semibold">{briefing.count}</p>
			</div>
			<div class="rounded-lg border p-3">
				<p class="text-xs text-muted-foreground">Default briefing cost</p>
				<p class="text-lg font-semibold">≈{approxTokens} tokens</p>
			</div>
		</div>

		{#if briefing.truncated}
			<div
				class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-600 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100"
				role="status"
			>
				{#if !showAll}
					<span>
						Showing {briefing.count} of {briefing.count + briefing.omitted} standing rules — this is the
						AI's budget-limited view.
					</span>
					<Button
						size="sm"
						variant="outline"
						onclick={() => {
							showAll = true;
							void load();
						}}
					>
						Show all {briefing.count + briefing.omitted}
					</Button>
				{:else}
					<span>
						Incomplete: {briefing.omitted} rule{briefing.omitted === 1 ? '' : 's'} left out of this fetch.
					</span>
				{/if}
			</div>
		{/if}

		{#if briefing.count === 0}
			<Card>
				<CardContent class="space-y-3 py-10 text-center">
					<p class="text-sm text-muted-foreground">
						No standing rules{namespace === 'all' ? '' : ` in "${namespace}"`}. Create the first one
						— rules load into every AI session.
					</p>
					<Button variant="outline" onclick={openCreate}>New standing rule</Button>
				</CardContent>
			</Card>
		{:else}
			{#each briefing.memories as m (m.id)}
				<Card>
					<CardHeader class="flex-row items-start justify-between gap-3">
						<div class="flex flex-wrap items-center gap-2">
							{#if m.type}
								<Badge class={TYPE_BADGE[m.type as keyof typeof TYPE_BADGE] ?? ''}>
									{m.type}
								</Badge>
							{/if}
							{#if m.core}
								<Badge>always</Badge>
							{:else}
								<Badge variant="outline">tail</Badge>
							{/if}
							<Badge variant="outline">{importancePct(m.importance)}%</Badge>
						</div>
						<div class="flex gap-1">
							<Button
								variant="ghost"
								size="icon"
								onclick={() => void promote(m)}
								aria-label="Promote rule"
								title="Promote (+5% — rank within the briefing)"
							>
								<ChevronUp class="size-4" />
							</Button>
							<Button
								variant="ghost"
								size="icon"
								onclick={() => void demote(m)}
								aria-label="Demote rule"
								title="Demote (−5% — rank only; remove the `always` tag to leave core)"
							>
								<ChevronDown class="size-4" />
							</Button>
							<Button
								variant="ghost"
								size="icon"
								onclick={() => void openEdit(m)}
								aria-label="Edit rule"
							>
								<Pencil class="size-4" />
							</Button>
							<Button
								variant="ghost"
								size="icon"
								onclick={() => void archive(m)}
								aria-label="Archive rule"
							>
								<Archive class="size-4" />
							</Button>
							<Button
								variant="ghost"
								size="icon"
								onclick={() =>
									(pendingDelete = {
										title: 'Delete this standing rule?',
										description: 'It will no longer load in any AI session. This cannot be undone.',
										run: () => del(String(m.id))
									})}
								aria-label="Delete rule"
							>
								<Trash2 class="size-4 text-destructive" />
							</Button>
						</div>
					</CardHeader>
					<CardContent class="space-y-2">
						<p class="text-sm leading-relaxed whitespace-pre-wrap">{m.content}</p>
						{#if isCompacted(m.content)}
							<p class="text-xs text-muted-foreground">
								Compacted to the briefing's 400-character cap — open Edit to see the full text.
							</p>
						{/if}
					</CardContent>
				</Card>
			{/each}
		{/if}
	{/if}
</div>

<MemoryFormDialog
	bind:open={showForm}
	namespaces={namespaceList}
	memory={formMemory}
	onSaved={() => void load()}
/>

<ConfirmDeleteDialog
	open={pendingDelete !== null}
	onClose={() => (pendingDelete = null)}
	title={pendingDelete?.title ?? 'Delete this item?'}
	description={pendingDelete?.description ?? ''}
	onConfirm={pendingDelete?.run}
/>
