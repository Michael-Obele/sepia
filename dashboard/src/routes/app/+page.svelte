<script lang="ts">
	import {
		Search,
		Layers,
		Boxes,
		Network,
		RefreshCw,
		Plus,
		Database,
		Clock,
		LoaderCircle,
		RotateCcw,
		MessagesSquare,
		X,
		Trash2
	} from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import { toast } from 'svelte-sonner';
	import {
		getStatsData,
		searchAll,
		runConsolidate,
		getNamespaces,
		removeMemory
	} from '$lib/remote/index.js';
	import { auth, isAuthed } from '$lib/auth.svelte';
	import { formatDate, timeAgo, importancePct, TYPE_BADGE, truncate } from '$lib/format.js';
	import { goto } from '$app/navigation';
	import { useSearchParams } from 'runed/kit';
	import { appSearchSchema, SEARCH_PARAMS_OPTIONS } from '$lib/search-params.js';
	import { PersistedState } from 'runed';
	import ConfirmDeleteDialog from '$lib/components/confirm-delete-dialog.svelte';
	import { onMount } from 'svelte';

	// Only create queries when signed in — avoids SSR calls with an empty token.
	const stats = $derived(isAuthed() ? getStatsData(auth.token) : null);
	const namespaces = $derived(isAuthed() ? getNamespaces(auth.token) : null);

	// URL-backed search — validated with valibot, restored on back/forward.
	const params = useSearchParams(appSearchSchema, SEARCH_PARAMS_OPTIONS);

	let results = $state<Awaited<ReturnType<typeof searchAll>> | null>(null);
	let searching = $state(false);

	// Guard against out-of-order responses when the query changes mid-flight.
	let searchSeq = 0;

	async function doSearch(q: string, ns: string) {
		const seq = ++searchSeq;
		searching = true;
		try {
			const res = await searchAll([
				auth.token,
				{
					q,
					namespace: ns === 'all' ? undefined : ns,
					limit: 10
				}
			]);
			if (seq !== searchSeq) return;
			results = res;
		} finally {
			if (seq === searchSeq) searching = false;
		}
	}

	// Resume: if the URL carries a committed query on load, run it once.
	onMount(() => {
		if (params.q.trim() !== '' || params.namespace !== 'all') {
			doSearch(params.q, params.namespace);
		}
	});

	// Enter / Search button — the only way a search starts (no auto-search).
	function submit() {
		if (params.q.trim() === '' && params.namespace === 'all') {
			searchSeq++; // invalidate any in-flight search
			results = null;
			searching = false;
			return;
		}
		doSearch(params.q, params.namespace);
	}

	function resetSearch() {
		params.reset();
		searchSeq++;
		results = null;
		searching = false;
	}

	async function consolidate() {
		const res = await runConsolidate(auth.token);
		toast.success('Consolidation complete', {
			description: `${res.archived_stale} stale, ${res.archived_duplicates} duplicates archived, ${res.purged} purged`
		});
		stats?.refresh();
	}

	function resultHref(r: { kind: string; id: string }) {
		return r.kind === 'entity' ? `/app/entities/${r.id}` : `/app/memories/${r.id}`;
	}

	// Recent memories card: dismissible (persisted) + per-row delete.
	const recentHidden = new PersistedState('sepia-recent-hidden', false);

	// Delete confirmation — the dialog gates the actual delete.
	let pendingDelete = $state<{
		title: string;
		description: string;
		run: () => void | Promise<void>;
	} | null>(null);

	async function deleteRecent(id: string) {
		await removeMemory([auth.token, id]);
		toast.success('Memory deleted');
		stats?.refresh();
	}
</script>

<svelte:head><title>Sepia — Search</title></svelte:head>

<div class="max-w-full min-w-0 space-y-6 overflow-hidden">
	<div class="flex flex-col gap-2">
		<h1 class="text-2xl font-semibold tracking-tight">Memory</h1>
		<p class="text-sm text-muted-foreground">
			Search everything your AI agents have stored — memories, entities, and relations.
		</p>
	</div>

	{#if stats}
		{#await stats}
			<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
				{#each [0, 1, 2, 3, 4] as _, i (i)}
					<Skeleton class="h-24 w-full" />
				{/each}
			</div>
		{:then s}
			<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
				<Card>
					<CardContent class="flex items-center gap-3 p-4">
						<div
							class="flex size-10 items-center justify-center rounded-lg bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
						>
							<Database class="size-5" />
						</div>
						<div>
							<p class="text-2xl font-semibold">{s.memories}</p>
							<p class="text-xs text-muted-foreground">Memories</p>
						</div>
					</CardContent>
				</Card>
				<Card>
					<CardContent class="flex items-center gap-3 p-4">
						<div
							class="flex size-10 items-center justify-center rounded-lg bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300"
						>
							<Boxes class="size-5" />
						</div>
						<div>
							<p class="text-2xl font-semibold">{s.entities}</p>
							<p class="text-xs text-muted-foreground">Entities</p>
						</div>
					</CardContent>
				</Card>
				<Card>
					<CardContent class="flex items-center gap-3 p-4">
						<div
							class="flex size-10 items-center justify-center rounded-lg bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300"
						>
							<Network class="size-5" />
						</div>
						<div>
							<p class="text-2xl font-semibold">{s.relations}</p>
							<p class="text-xs text-muted-foreground">Relations</p>
						</div>
					</CardContent>
				</Card>
				<Card>
					<CardContent class="flex items-center gap-3 p-4">
						<div
							class="flex size-10 items-center justify-center rounded-lg bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300"
						>
							<MessagesSquare class="size-5" />
						</div>
						<div>
							<p class="text-2xl font-semibold">{s.conversations}</p>
							<p class="text-xs text-muted-foreground">Conversations</p>
						</div>
					</CardContent>
				</Card>
				<Card>
					<CardContent class="flex items-center gap-3 p-4">
						<div
							class="flex size-10 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
						>
							<RefreshCw class="size-5" />
						</div>
						<div>
							<p class="text-2xl font-semibold">{s.decay_candidates}</p>
							<p class="text-xs text-muted-foreground">Decay candidates</p>
						</div>
					</CardContent>
				</Card>
			</div>
		{:catch e}
			<p class="text-sm text-destructive">Failed to load stats: {e?.message ?? 'unknown error'}</p>
		{/await}
	{/if}

	<Card>
		<CardHeader>
			<CardTitle class="text-base">Search</CardTitle>
			<CardDescription>Same engine as the MCP search tool.</CardDescription>
		</CardHeader>
		<CardContent class="min-w-0 space-y-3 overflow-hidden">
			<div class="flex min-w-0 flex-col gap-2 sm:flex-row">
				<div class="relative min-w-0 flex-1">
					<Search class="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
					<Input
						bind:value={params.q}
						placeholder="Search memories and entities…"
						class="pl-9"
						aria-label="Search memories and entities"
						onkeydown={(e) => {
							if (e.key === 'Enter') submit();
						}}
					/>
				</div>
				<select
					bind:value={params.namespace}
					class="h-9 rounded-md border border-input bg-background px-3 text-sm"
					aria-label="Namespace filter"
				>
					<option value="all">All namespaces</option>
					{#if namespaces}
						{#await namespaces}
							<option disabled>Loading…</option>
						{:then ns}
							{#each ns as n (n.name)}
								<option value={n.name}>{n.name}</option>
							{/each}
						{/await}
					{/if}
				</select>
				<Button onclick={submit} disabled={searching}>
					{#if searching}<LoaderCircle class="size-4 animate-spin" />{/if}
					Search
				</Button>
				<Button variant="outline" onclick={resetSearch} disabled={searching}>
					<RotateCcw class="size-4" /> Reset
				</Button>
			</div>

			{#if results}
				<Separator />
				{#if searching}
					<p class="flex items-center gap-2 py-2 text-xs text-muted-foreground">
						<LoaderCircle class="size-3.5 animate-spin" /> Searching…
					</p>
				{/if}
				<div class="space-y-1">
					{#if results.length === 0}
						<p class="py-4 text-center text-sm text-muted-foreground">
							{params.q ? `No results for “${params.q}”.` : 'No results.'}
						</p>
					{:else}
						{#each results as r (r.kind + r.id)}
							<a
								href={resultHref(r)}
								class="flex min-w-0 items-start gap-3 overflow-hidden rounded-md p-2 transition-colors hover:bg-accent"
							>
								<Badge variant="outline" class="mt-0.5 shrink-0">
									{r.kind === 'entity' ? 'Entity' : 'Memory'}
								</Badge>
								<div class="min-w-0 flex-1 overflow-hidden">
									<p class="min-w-0 text-sm font-medium break-words">
										{r.kind === 'entity' ? r.name : truncate(r.content ?? '', 120)}
									</p>
									<p class="min-w-0 truncate text-xs text-muted-foreground">
										{r.kind === 'memory' ? truncate(r.content ?? '', 200) : r.snippet}
									</p>
								</div>
								<div class="flex shrink-0 flex-col items-end gap-1">
									<Badge class={TYPE_BADGE[r.type as keyof typeof TYPE_BADGE] ?? ''}>{r.type}</Badge
									>
									<span class="text-xs text-muted-foreground">{importancePct(r.importance)}%</span>
								</div>
							</a>
						{/each}
					{/if}
				</div>
			{/if}
		</CardContent>
	</Card>

	<div class="flex flex-wrap gap-2">
		<Button variant="outline" onclick={() => goto('/app/memories?new=1')}>
			<Plus class="size-4" /> New memory
		</Button>
		<Button variant="outline" onclick={() => goto('/app/entities?new=1')}>
			<Plus class="size-4" /> New entity
		</Button>
		<Button variant="outline" onclick={consolidate}>
			<RefreshCw class="size-4" /> Run consolidate
		</Button>
		{#if recentHidden.current}
			<Button variant="ghost" onclick={() => (recentHidden.current = false)}>
				<Clock class="size-4" /> Show recent memories
			</Button>
		{/if}
	</div>

	{#if stats}
		{#await stats}
			<Skeleton class="h-40 w-full" />
		{:then s}
			{#if !recentHidden.current && s.recent_memories.length > 0}
				<Card>
					<CardHeader class="pb-3">
						<div class="flex items-start justify-between gap-2">
							<div>
								<CardTitle class="flex items-center gap-2 text-base">
									<Clock class="size-4" /> Recent memories
								</CardTitle>
								<CardDescription>Most recently updated across all namespaces.</CardDescription>
							</div>
							<Button
								variant="ghost"
								size="icon"
								class="size-7"
								onclick={() => (recentHidden.current = true)}
								aria-label="Hide recent memories"
								title="Hide this card"
							>
								<X class="size-4" />
							</Button>
						</div>
					</CardHeader>
					<CardContent class="space-y-3">
						{#each s.recent_memories as m (m.id)}
							<div
								class="group flex min-w-0 items-start gap-2 rounded-md p-2 transition-colors hover:bg-accent"
							>
								<a href={`/app/memories/${m.id}`} class="block min-w-0 flex-1 overflow-hidden">
									<div class="flex min-w-0 items-start justify-between gap-3 overflow-hidden">
										<p class="min-w-0 flex-1 text-sm break-words">
											{truncate(m.content, 200)}
										</p>
										<span class="shrink-0 text-xs text-muted-foreground"
											>{timeAgo(m.updated_at)}</span
										>
									</div>
									<div class="mt-1 flex items-center gap-2">
										<Badge class={TYPE_BADGE[m.type as keyof typeof TYPE_BADGE] ?? ''}
											>{m.type}</Badge
										>
										<span class="text-xs text-muted-foreground">{m.namespace || '—'}</span>
										<span class="text-xs text-muted-foreground"
											>· {importancePct(m.importance)}%</span
										>
									</div>
								</a>
								<Button
									variant="ghost"
									size="icon"
									class="size-7 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
									onclick={() =>
										(pendingDelete = {
											title: 'Delete this memory?',
											description: `"${truncate(m.content, 80)}" will be permanently lost. This cannot be undone.`,
											run: () => deleteRecent(String(m.id))
										})}
									aria-label="Delete memory"
									title="Delete this memory"
								>
									<Trash2 class="size-3.5 text-destructive" />
								</Button>
							</div>
						{/each}
					</CardContent>
				</Card>
			{/if}
		{/await}
	{/if}

	<ConfirmDeleteDialog
		open={pendingDelete !== null}
		onClose={() => (pendingDelete = null)}
		title={pendingDelete?.title ?? 'Delete this item?'}
		description={pendingDelete?.description ?? ''}
		onConfirm={pendingDelete?.run}
	/>
</div>
