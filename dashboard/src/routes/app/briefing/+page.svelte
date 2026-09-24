<script lang="ts">
	import { Plus, Pencil, Trash2, Archive, ChevronUp, ChevronDown } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Card, CardContent, CardHeader } from '$lib/components/ui/card/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { toast } from 'svelte-sonner';
	import {
		getBriefingData,
		getMemories,
		getNamespaces,
		getMemoryDetail,
		updateMemoryData,
		removeMemory
	} from '$lib/remote/index.js';
	import { fresh } from '$lib/fresh.js';
	import { importancePct, TYPE_BADGE, truncate } from '$lib/format.js';
	import MemoryFormDialog from '$lib/components/memory-form-dialog.svelte';
	import ConfirmDeleteDialog from '$lib/components/confirm-delete-dialog.svelte';
	import { ALWAYS_TAG, CORE_IMPORTANCE, BRIEFING_ITEM_CHARS } from '@sepia/shared/types';

	let { data } = $props();
	const isAuthed = () => Boolean(data.user);

	// Controls: which slice of the standing rules to show.
	let ns = $state('all');
	let detail = $state<'core' | 'all'>('core');

	const namespaces = $derived(isAuthed() ? getNamespaces() : null);
	let namespaceList = $state<string[]>([]);
	$effect(() => {
		namespaces?.then((list) => {
			namespaceList = list.map((n) => n.name);
		});
	});

	type Briefing = Awaited<ReturnType<typeof getBriefingData>>;
	let briefing = $state.raw<Briefing | null>(null);
	let loading = $state(true);
	let error = $state('');

	// Guard against out-of-order responses when controls change mid-flight.
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
					namespace: ns === 'all' ? undefined : ns,
					detail
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

	// Load on mount and whenever the namespace / slice controls change.
	$effect(() => {
		void ns;
		void detail;
		if (isAuthed()) void load();
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

	/** New rule, prefilled to land in core (instruction @ ≥90%). No `id` → dialog creates. */
	function openCreate() {
		formMemory = {
			content: '',
			type: 'instruction',
			importance: CORE_IMPORTANCE,
			namespace: ns !== 'all' ? ns : (namespaceList[0] ?? 'personal'),
			tags: [],
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

	// --- promote / demote: importance IS the rank ------------------------------

	/** One click crosses the 90% core boundary; further clicks rank within. */
	function nextImportance(imp: number, dir: 'up' | 'down'): number {
		const r = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 100) / 100;
		if (dir === 'up') {
			if (imp < CORE_IMPORTANCE) return CORE_IMPORTANCE;
			return r(imp + 0.05);
		}
		if (imp > CORE_IMPORTANCE) return CORE_IMPORTANCE;
		return r(imp - 0.05);
	}

	async function promote(m: { id: string; importance: number | null; tags: string[] | null }) {
		const imp = m.importance ?? 0.5;
		const next = nextImportance(imp, 'up');
		if (next === imp) {
			toast.info('Already at 100%');
			return;
		}
		await updateMemoryData([String(m.id), { importance: next }]);
		toast.success(
			imp < CORE_IMPORTANCE
				? `Promoted to core (${Math.round(next * 100)}%)`
				: `Promoted to ${Math.round(next * 100)}%`
		);
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
		if (next < CORE_IMPORTANCE && tagged) {
			toast.warning(`Importance ${Math.round(next * 100)}% — still core via \`always\` tag`);
		} else if (imp >= CORE_IMPORTANCE && next < CORE_IMPORTANCE) {
			toast.success(`Demoted to tail (${Math.round(next * 100)}%)`);
		} else {
			toast.success(`Demoted to ${Math.round(next * 100)}%`);
		}
		void load();
	}

	// --- elevate existing memories into rules (submit-gated search) -----------

	let elevateQuery = $state('');
	let elevateResults = $state<Awaited<ReturnType<typeof getMemories>> | null>(null);
	let elevating = $state(false);

	async function searchExisting() {
		const q = elevateQuery.trim();
		if (!q || elevating) return;
		elevating = true;
		try {
			elevateResults = await fresh(getMemories({ q, limit: 8 }));
		} catch (e) {
			toast.error((e as Error)?.message ?? 'Search failed');
		} finally {
			elevating = false;
		}
	}

	/** Elevate: merge `always` into the row's OWN tags — a tags update replaces the set. */
	async function elevate(m: { id: string; tags?: string[] | null }) {
		const tags = m.tags ?? [];
		if (tags.includes(ALWAYS_TAG)) return;
		await updateMemoryData([String(m.id), { tags: [...tags, ALWAYS_TAG] }]);
		toast.success('Elevated to a standing rule — loads in every AI session');
		elevateQuery = '';
		elevateResults = null;
		void load();
	}
</script>

<svelte:head><title>Sepia — Briefing</title></svelte:head>

<div class="space-y-6">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div class="max-w-2xl">
			<h1 class="text-2xl font-semibold tracking-tight">Briefing</h1>
			<p class="text-sm text-muted-foreground">
				The standing rules every AI loads at session start — before any work. Edit them here; your
				AIs edit them too via
				<code class="rounded bg-muted px-1 py-0.5 text-xs">manage_memory</code> — same data.
			</p>
		</div>
		<Button onclick={openCreate}><Plus class="size-4" /> New standing rule</Button>
	</div>

	{#if isAuthed()}
		<!-- Controls -->
		<Card>
			<CardContent class="flex flex-wrap items-end gap-4 py-4">
				<div class="space-y-2">
					<Label for="briefing-ns">Namespace</Label>
					<select
						id="briefing-ns"
						bind:value={ns}
						class="h-9 rounded-md border border-input bg-background px-3 text-sm"
					>
						<option value="all">All namespaces</option>
						{#each namespaceList as name (name)}
							<option value={name}>{name}</option>
						{/each}
					</select>
				</div>
				<div class="space-y-2">
					<span class="text-sm leading-none font-medium">Slice</span>
					<div class="flex gap-1 rounded-lg border p-1">
						<Button
							size="sm"
							variant={detail === 'core' ? 'secondary' : 'ghost'}
							onclick={() => (detail = 'core')}
						>
							Core only
						</Button>
						<Button
							size="sm"
							variant={detail === 'all' ? 'secondary' : 'ghost'}
							onclick={() => (detail = 'all')}
						>
							All standing rules
						</Button>
					</div>
				</div>
			</CardContent>
		</Card>

		<!-- Elevate an existing memory into a rule -->
		<Card>
			<CardContent class="space-y-3 py-4">
				<form
					class="flex flex-wrap gap-2"
					onsubmit={(e) => {
						e.preventDefault();
						void searchExisting();
					}}
				>
					<Input
						bind:value={elevateQuery}
						placeholder="Add existing rule — search your memories…"
						aria-label="Search memories to elevate"
						class="max-w-md flex-1"
					/>
					<Button type="submit" variant="outline" disabled={elevating}>
						{elevating ? 'Searching…' : 'Search'}
					</Button>
				</form>
				{#if elevateResults}
					{#if elevateResults.length === 0}
						<p class="text-sm text-muted-foreground">No memories match “{elevateQuery}”.</p>
					{:else}
						<div class="max-h-64 space-y-1 overflow-y-auto rounded-md border p-1">
							{#each elevateResults as r (r.id)}
								<div class="flex items-center justify-between gap-2 px-2 py-1.5">
									<span class="min-w-0 flex-1 truncate text-sm">{truncate(r.content, 90)}</span>
									{#if r.tags?.includes(ALWAYS_TAG)}
										<Badge variant="secondary">already a rule</Badge>
									{:else}
										<Button size="sm" variant="outline" onclick={() => void elevate(r)}>
											Elevate
										</Button>
									{/if}
								</div>
							{/each}
						</div>
					{/if}
				{/if}
			</CardContent>
		</Card>

		{#if loading && !briefing}
			<div class="space-y-3">
				<Skeleton class="h-24 w-full" />
				<Skeleton class="h-24 w-full" />
			</div>
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
					{#if detail === 'core' && briefing.other_standing > 0}
						<p class="text-xs text-muted-foreground">Switch to All to review them</p>
					{/if}
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
					class="rounded-lg border border-amber-600 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100"
					role="status"
				>
					Incomplete: {briefing.omitted} rule{briefing.omitted === 1 ? '' : 's'} left out of this {detail ===
					'all'
						? 'budgeted slice'
						: 'core set'}.
				</div>
			{/if}

			{#if briefing.count === 0}
				<Card>
					<CardContent class="space-y-3 py-10 text-center">
						<p class="text-sm text-muted-foreground">
							No standing rules{ns === 'all' ? '' : ` in "${ns}"`}. Create the first one — rules
							load into every AI session.
						</p>
						<Button variant="outline" onclick={openCreate}>New standing rule</Button>
					</CardContent>
				</Card>
			{:else}
				<div class="space-y-3">
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
										<Badge variant={m.tags?.includes(ALWAYS_TAG) ? 'default' : 'secondary'}>
											{m.tags?.includes(ALWAYS_TAG) ? 'always' : 'core'}
										</Badge>
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
										title="Promote (+5%, or jump to 90% to enter core)"
									>
										<ChevronUp class="size-4" />
									</Button>
									<Button
										variant="ghost"
										size="icon"
										onclick={() => void demote(m)}
										aria-label="Demote rule"
										title="Demote (−5%, or below 90% to leave core)"
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
										aria-label="Delete rule"
										onclick={() =>
											(pendingDelete = {
												title: 'Delete this standing rule?',
												description:
													'It will no longer load in any AI session. This cannot be undone.',
												run: () => del(String(m.id))
											})}
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
				</div>
			{/if}
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
