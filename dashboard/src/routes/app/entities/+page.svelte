<script lang="ts">
	import { Plus, Search, SlidersHorizontal, LoaderCircle, RotateCcw } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { toast } from 'svelte-sonner';
	import { getEntities, getNamespaces, removeEntity } from '$lib/remote/index.js';
	import { auth, isAuthed } from '$lib/auth.svelte';
	import { importancePct, entityTypeBadge, truncate } from '$lib/format.js';
	import EntityFormDialog from '$lib/components/entity-form-dialog.svelte';
	import ConfirmDeleteDialog from '$lib/components/confirm-delete-dialog.svelte';
	import { page } from '$app/state';
	import { Trash2 } from '@lucide/svelte';
	import { ENTITY_TYPES } from '@sepia/shared';
	import { useSearchParams } from 'runed/kit';
	import { entitiesSearchSchema, SEARCH_PARAMS_OPTIONS } from '$lib/search-params.js';
	import { onMount } from 'svelte';

	const namespaces = $derived(isAuthed() ? getNamespaces(auth.token) : null);
	let namespaceList = $state<string[]>([]);
	$effect(() => {
		namespaces?.then((ns) => (namespaceList = ns.map((n) => n.name)));
	});

	// URL-backed filters — validated with valibot, restored on back/forward.
	const params = useSearchParams(entitiesSearchSchema, SEARCH_PARAMS_OPTIONS);

	let entities = $state<Awaited<ReturnType<typeof getEntities>>>([]);
	let loading = $state(true);
	let loadingMore = $state(false);
	let hasMore = $state(true);
	let error = $state('');
	let showCreate = $state(false);
	const PAGE_SIZE = 50;

	// Delete confirmation — the dialog gates the actual delete.
	let pendingDelete = $state<{
		title: string;
		description: string;
		run: () => void | Promise<void>;
	} | null>(null);

	// Guard against out-of-order responses when filters change mid-flight.
	let loadSeq = 0;

	async function load() {
		const seq = ++loadSeq;
		loading = true;
		error = '';
		try {
			const result = await getEntities([
				auth.token,
				{
					q: params.q || undefined,
					namespace: params.namespace === 'all' ? undefined : params.namespace,
					type: params.type || undefined,
					limit: PAGE_SIZE
				}
			]);
			if (seq !== loadSeq) return;
			entities = result;
			hasMore = result.length >= PAGE_SIZE;
		} catch (e) {
			if (seq !== loadSeq) return;
			error = (e as Error)?.message ?? 'Failed to load entities';
		} finally {
			if (seq === loadSeq) loading = false;
		}
	}

	async function loadMore() {
		if (loadingMore) return;
		loadingMore = true;
		error = '';
		try {
			const next = await getEntities([
				auth.token,
				{
					q: params.q || undefined,
					namespace: params.namespace === 'all' ? undefined : params.namespace,
					type: params.type || undefined,
					limit: PAGE_SIZE,
					offset: entities.length
				}
			]);
			entities = [...entities, ...next];
			hasMore = next.length >= PAGE_SIZE;
		} catch (e) {
			error = (e as Error)?.message ?? 'Failed to load more entities';
		} finally {
			loadingMore = false;
		}
	}

	async function del(id: string) {
		await removeEntity([auth.token, id]);
		toast.success('Entity deleted');
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

<svelte:head><title>Sepia — Entities</title></svelte:head>

<div class="space-y-6">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<h1 class="text-2xl font-semibold tracking-tight">Entities</h1>
			<p class="text-sm text-muted-foreground">
				Knowledge-graph nodes — people, projects, tools, concepts.
			</p>
		</div>
		<Button onclick={() => (showCreate = true)}>
			<Plus class="size-4" /> New entity
		</Button>
	</div>

	<Card>
		<CardHeader>
			<CardTitle class="flex items-center gap-2 text-base">
				<SlidersHorizontal class="size-4" /> Filters
			</CardTitle>
		</CardHeader>
		<CardContent class="flex flex-wrap items-end gap-3">
			<div class="relative min-w-48 flex-1">
				<Search class="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
				<Input
					bind:value={params.q}
					placeholder="Search by name…"
					class="pl-9"
					aria-label="Search by name"
					onkeydown={(e) => {
						if (e.key === 'Enter') load();
					}}
				/>
			</div>
			<select
				bind:value={params.namespace}
				class="h-9 rounded-md border border-input bg-background px-3 text-sm"
				aria-label="Namespace filter"
			>
				<option value="all">All namespaces</option>
				{#each namespaceList as n (n)}
					<option value={n}>{n}</option>
				{/each}
			</select>
			<select
				bind:value={params.type}
				class="h-9 w-40 rounded-md border border-input bg-background px-3 text-sm"
				aria-label="Entity type filter"
			>
				<option value="">All types</option>
				{#each ENTITY_TYPES as t (t)}
					<option value={t}>{t}</option>
				{/each}
			</select>
			<Button variant="default" onclick={load}>
				<Search class="size-4" /> Apply
			</Button>
			<Button variant="outline" onclick={resetFilters}>
				<RotateCcw class="size-4" /> Reset
			</Button>
		</CardContent>
	</Card>

	{#if error}
		<p class="text-sm text-destructive">{error}</p>
	{/if}

	{#if loading}
		<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
			{#each [0, 1, 2, 3, 4, 5] as _, i (i)}
				<Skeleton class="h-28 w-full" />
			{/each}
		</div>
	{:else if entities.length === 0}
		<Card>
			<CardContent class="py-10 text-center text-sm text-muted-foreground">
				No entities match these filters.
			</CardContent>
		</Card>
	{:else}
		<div class="space-y-3">
			<p class="text-xs text-muted-foreground">
				Showing {entities.length} entities{hasMore ? ' — load more to see the rest' : ''}
			</p>
			<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{#each entities as e (e.id)}
					<Card>
						<CardContent class="p-4">
							<div class="flex items-start justify-between gap-2">
								<a href={`/app/entities/${e.id}`} class="min-w-0 flex-1">
									<p class="truncate text-sm font-medium">{e.name}</p>
									<p class="mt-1 line-clamp-2 text-xs text-muted-foreground">
										{truncate(e.summary ?? '', 120)}
									</p>
									<div class="mt-2 flex flex-wrap items-center gap-2">
										<Badge class={entityTypeBadge(e.type)}>{e.type}</Badge>
										<span class="text-xs text-muted-foreground">{importancePct(e.importance)}%</span
										>
									</div>
									{#if e.tags?.length}
										<div class="mt-2 flex flex-wrap gap-1">
											{#each e.tags as tag (tag)}
												<span
													class="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground"
												>
													{tag}
												</span>
											{/each}
										</div>
									{/if}
								</a>
								<Button
									variant="ghost"
									size="icon"
									onclick={() =>
										(pendingDelete = {
											title: 'Delete this entity?',
											description: `"${e.name}" and its relations will be removed. Linked memories are unlinked (not deleted).`,
											run: () => del(String(e.id))
										})}
									aria-label="Delete entity"
								>
									<Trash2 class="size-4 text-destructive" />
								</Button>
							</div>
						</CardContent>
					</Card>
				{/each}
			</div>
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

	<EntityFormDialog bind:open={showCreate} namespaces={namespaceList} onSaved={load} />

	<ConfirmDeleteDialog
		open={pendingDelete !== null}
		onClose={() => (pendingDelete = null)}
		title={pendingDelete?.title ?? 'Delete this item?'}
		description={pendingDelete?.description ?? ''}
		onConfirm={pendingDelete?.run}
	/>
</div>
