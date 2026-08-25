<script lang="ts">
	import {
		Plus,
		Trash2,
		Archive,
		ArchiveRestore,
		Search,
		SlidersHorizontal,
		LoaderCircle,
		RotateCcw
	} from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import { toast } from 'svelte-sonner';
	import { getMemories, getNamespaces, removeMemory, updateMemoryData } from '$lib/remote/index.js';
	import { auth, isAuthed } from '$lib/auth.svelte';
	import { timeAgo, importancePct, TYPE_BADGE, truncate } from '$lib/format.js';
	import MemoryFormDialog from '$lib/components/memory-form-dialog.svelte';
	import { page } from '$app/state';
	import { MEMORY_TYPES } from '@sepia/shared';
	import { useSearchParams } from 'runed/kit';
	import { memoriesSearchSchema, SEARCH_PARAMS_OPTIONS } from '$lib/search-params.js';
	import { onMount } from 'svelte';

	const namespaces = $derived(isAuthed() ? getNamespaces(auth.token) : null);
	let namespaceList = $state<string[]>([]);

	$effect(() => {
		namespaces?.then((ns) => {
			namespaceList = ns.map((n) => n.name);
		});
	});

	// URL-backed filters — validated with valibot, restored on back/forward.
	const params = useSearchParams(memoriesSearchSchema, SEARCH_PARAMS_OPTIONS);

	let limit = $state(20);
	let offset = $state(0);

	let memories = $state<Awaited<ReturnType<typeof getMemories>>>([]);
	let loading = $state(true);
	let loadingMore = $state(false);
	let hasMore = $state(true);
	let error = $state('');

	let showCreate = $state(false);

	// Guard against out-of-order responses when filters change mid-flight.
	let loadSeq = 0;

	async function load() {
		const seq = ++loadSeq;
		loading = true;
		error = '';
		offset = 0;
		try {
			const result = await getMemories([
				auth.token,
				{
					q: params.q || undefined,
					type: params.type === 'all' ? undefined : params.type,
					namespace: params.namespace === 'all' ? undefined : params.namespace,
					archived: params.archived,
					importance_min: params.minImportance > 0 ? params.minImportance : undefined,
					limit,
					offset: 0
				}
			]);
			if (seq !== loadSeq) return;
			memories = result;
			hasMore = result.length >= limit;
		} catch (e) {
			if (seq !== loadSeq) return;
			error = (e as Error)?.message ?? 'Failed to load memories';
		} finally {
			if (seq === loadSeq) loading = false;
		}
	}

	async function loadMore() {
		if (loadingMore) return;
		loadingMore = true;
		error = '';
		try {
			const next = await getMemories([
				auth.token,
				{
					q: params.q || undefined,
					type: params.type === 'all' ? undefined : params.type,
					namespace: params.namespace === 'all' ? undefined : params.namespace,
					archived: params.archived,
					importance_min: params.minImportance > 0 ? params.minImportance : undefined,
					limit,
					offset: offset + limit
				}
			]);
			memories = [...memories, ...next];
			offset += limit;
			hasMore = next.length >= limit;
		} catch (e) {
			error = (e as Error)?.message ?? 'Failed to load more memories';
		} finally {
			loadingMore = false;
		}
	}

	async function del(id: string) {
		if (!confirm('Delete this memory permanently?')) return;
		await removeMemory([auth.token, id]);
		toast.success('Memory deleted');
		load();
	}

	async function toggleArchive(m: { id: string; archived: boolean | null }) {
		await updateMemoryData([auth.token, String(m.id), { archived: !m.archived }]);
		toast.success(m.archived ? 'Restored from archive' : 'Archived');
		load();
	}

	// Open the create dialog when navigated with ?new=1, then strip the param
	// (preserving any active filter params in the URL).
	$effect(() => {
		if (page.url.searchParams.get('new') === '1') {
			showCreate = true;
			const sp = new URLSearchParams(page.url.searchParams);
			sp.delete('new');
			const qs = sp.toString();
			history.replaceState(null, '', qs ? `${page.url.pathname}?${qs}` : page.url.pathname);
		}
	});

	// Load once on mount (with any URL-restored filters). Searches run on
	// Enter/Apply — typing only updates the URL, never the results.
	onMount(() => {
		load();
	});

	function resetFilters() {
		params.reset();
		load();
	}
</script>

<svelte:head><title>Sepia — Memories</title></svelte:head>

<div class="space-y-6">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<h1 class="text-2xl font-semibold tracking-tight">Memories</h1>
			<p class="text-sm text-muted-foreground">Browse and manage knowledge fragments.</p>
		</div>
		<Button onclick={() => (showCreate = true)}>
			<Plus class="size-4" /> New memory
		</Button>
	</div>

	<Card>
		<CardHeader class="pb-3">
			<CardTitle class="flex items-center gap-2 text-base">
				<SlidersHorizontal class="size-4" /> Filters
			</CardTitle>
			<p class="text-sm text-muted-foreground">Refine by text, type, namespace and importance.</p>
		</CardHeader>
		<CardContent class="space-y-4">
			<!-- Search row -->
			<div class="relative">
				<Search
					class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
				/>
				<Input
					bind:value={params.q}
					placeholder="Filter by text…"
					class="w-full pl-9"
					aria-label="Filter by text"
					onkeydown={(e) => {
						if (e.key === 'Enter') load();
					}}
				/>
			</div>
			<!-- Controls row: fixed-width selects + actions -->
			<div class="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
				<div class="flex flex-wrap items-end gap-3">
					<div class="flex min-w-0 flex-col gap-1.5">
						<label for="filter-type" class="text-xs font-medium text-muted-foreground"
							>Memory type</label
						>
						<select
							id="filter-type"
							bind:value={params.type}
							class="h-9 w-full min-w-[160px] shrink-0 rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none sm:w-auto"
							aria-label="Memory type filter"
						>
							<option value="all">All types</option>
							{#each MEMORY_TYPES as t (t)}
								<option value={t}>{t}</option>
							{/each}
						</select>
					</div>
					<div class="flex min-w-0 flex-col gap-1.5">
						<label for="filter-ns" class="text-xs font-medium text-muted-foreground"
							>Namespace</label
						>
						<select
							id="filter-ns"
							bind:value={params.namespace}
							class="h-9 w-full min-w-[180px] shrink-0 rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none sm:w-auto"
							aria-label="Namespace filter"
						>
							<option value="all">All namespaces</option>
							{#each namespaceList as n (n)}
								<option value={n}>{n}</option>
							{/each}
						</select>
					</div>
					<div class="flex min-w-0 flex-col gap-1.5">
						<label for="filter-imp" class="text-xs font-medium text-muted-foreground"
							>Importance</label
						>
						<select
							id="filter-imp"
							bind:value={params.minImportance}
							class="h-9 w-full min-w-[160px] shrink-0 rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none sm:w-auto"
							aria-label="Minimum importance"
						>
							<option value={0}>Any importance</option>
							<option value={0.3}>≥ 30%</option>
							<option value={0.5}>≥ 50%</option>
							<option value={0.7}>≥ 70%</option>
							<option value={0.9}>≥ 90%</option>
						</select>
					</div>
				</div>
				<div class="flex flex-wrap items-center gap-3 xl:justify-end">
					<label
						for="filter-archived"
						class="flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 text-sm shadow-xs transition-colors has-[[data-state=checked]]:bg-muted"
					>
						<Switch id="filter-archived" bind:checked={params.archived} />
						<span>Show archived</span>
					</label>
					<Button
						variant="default"
						onclick={load}
						class="h-9 shrink-0 px-5 font-medium shadow-xs"
						aria-label="Apply filters"
					>
						<Search class="size-4" />
						Apply
					</Button>
					<Button
						variant="outline"
						onclick={resetFilters}
						class="h-9 shrink-0 px-5 font-medium shadow-xs"
						aria-label="Reset filters"
					>
						<RotateCcw class="size-4" />
						Reset
					</Button>
				</div>
			</div>
		</CardContent>
	</Card>

	{#if error}
		<p class="text-sm text-destructive">{error}</p>
	{/if}

	{#if loading}
		<div class="space-y-2">
			{#each [0, 1, 2, 3, 4] as _, i (i)}
				<Skeleton class="h-20 w-full" />
			{/each}
		</div>
	{:else if memories.length === 0}
		<Card>
			<CardContent class="py-10 text-center text-sm text-muted-foreground">
				No memories match these filters.
			</CardContent>
		</Card>
	{:else}
		<div class="space-y-2">
			<p class="text-xs text-muted-foreground">
				Showing {memories.length} memories{hasMore ? ' — load more to see the rest' : ''}
			</p>
			{#each memories as m (m.id)}
				<Card>
					<CardContent class="p-4">
						<div class="flex items-start justify-between gap-3">
							<a href={`/app/memories/${m.id}`} class="min-w-0 flex-1">
								<p class="text-sm">{truncate(m.content, 300)}</p>
								<div class="mt-2 flex flex-wrap items-center gap-2">
									<Badge class={TYPE_BADGE[m.type as keyof typeof TYPE_BADGE] ?? ''}>{m.type}</Badge
									>
									<span class="text-xs text-muted-foreground">{m.namespace}</span>
									<span class="text-xs text-muted-foreground">· {importancePct(m.importance)}%</span
									>
									<span class="text-xs text-muted-foreground">· {timeAgo(m.updatedAt)}</span>
									{#if m.archived}
										<Badge variant="outline">archived</Badge>
									{/if}
								</div>
								{#if m.tags?.length}
									<div class="mt-2 flex flex-wrap gap-1">
										{#each m.tags as tag (tag)}
											<span
												class="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground"
											>
												{tag}
											</span>
										{/each}
									</div>
								{/if}
							</a>
							<div class="flex shrink-0 gap-1">
								<Button
									variant="ghost"
									size="icon"
									onclick={() => toggleArchive(m)}
									aria-label={m.archived ? 'Restore' : 'Archive'}
								>
									{#if m.archived}
										<ArchiveRestore class="size-4" />
									{:else}
										<Archive class="size-4" />
									{/if}
								</Button>
								<Button
									variant="ghost"
									size="icon"
									onclick={() => del(String(m.id))}
									aria-label="Delete"
								>
									<Trash2 class="size-4 text-destructive" />
								</Button>
							</div>
						</div>
					</CardContent>
				</Card>
			{/each}
			{#if hasMore}
				<div class="flex justify-center pt-2">
					<Button variant="outline" onclick={loadMore} disabled={loadingMore}>
						{#if loadingMore}<LoaderCircle class="size-4 animate-spin" />{/if}
						Load more
					</Button>
				</div>
			{/if}
		</div>
	{/if}

	<MemoryFormDialog bind:open={showCreate} namespaces={namespaceList} onSaved={load} />
</div>
