<script lang="ts">
	import { Plus, Search, SlidersHorizontal, LoaderCircle, RotateCcw } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card/index.js';
	import { Badge } from '$lib/components/ui/badge';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { toast } from 'svelte-sonner';
	import { getEntitiesPage, getEntityList, removeEntity } from '$lib/remote/index.js';
	import { fresh } from '$lib/fresh.js';
	import { importancePct, entityTypeBadge, truncate } from '$lib/format.js';
	import EntityFormDialog from '$lib/components/entity-form-dialog.svelte';
	import ConfirmDeleteDialog from '$lib/components/confirm-delete-dialog.svelte';
	import SectionTabs from '$lib/components/section-tabs.svelte';
	import { page } from '$app/state';
	import { Trash2 } from '@lucide/svelte';
	import { ENTITY_TYPES } from '@sepia/shared/types';
	import { useSearchParams } from 'runed/kit';
	import { entitiesSearchSchema, SEARCH_PARAMS_OPTIONS } from '$lib/search-params.js';
	import { entityTabs } from '$lib/section-tabs.js';
	let { data } = $props();
	const isAuthed = () => Boolean(data.user);

	// URL-backed filters — validated with valibot, restored on back/forward.
	const params = useSearchParams(entitiesSearchSchema, SEARCH_PARAMS_OPTIONS);

	const PAGE_SIZE = 50;

	/** The one shape this page renders: the list plus the namespace dropdown. */
	type EntitiesPage = Awaited<ReturnType<typeof getEntitiesPage>>;

	/** Query args for the current URL filters, starting at `offset`. */
	function args(offset = 0) {
		return {
			q: params.q || undefined,
			namespace: params.namespace === 'all' ? undefined : params.namespace,
			type: params.type || undefined,
			limit: PAGE_SIZE,
			offset
		};
	}

	// AWAITED DURING SSR. A query called on the server runs in-process in this
	// same request — reusing the session the root +layout.server.ts already
	// resolved — and its result is serialised into the page payload. So the rows
	// are in the HTML and the browser makes NO initial data request for this
	// route. `getEntitiesPage` is ONE Neon HTTP round trip (list + namespaces).
	const initialPage = isAuthed() ? await getEntitiesPage(args()) : { entities: [], namespaces: [] };

	let view = $state<EntitiesPage>(initialPage);
	let entities = $derived(view.entities);
	const namespaceList = $derived(view.namespaces.map((n) => n.name));
	let loading = $state(false);
	let loadingMore = $state(false);
	let hasMore = $state(initialPage.entities.length >= PAGE_SIZE);
	let error = $state('');
	let showCreate = $state(false);

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
			const next = await fresh(getEntitiesPage(args()));
			if (seq !== loadSeq) return;
			view = next;
			hasMore = next.entities.length >= PAGE_SIZE;
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
			// Lean read, and no namespaces — a page append doesn't need the
			// dropdown options again.
			const next = await fresh(getEntityList(args(entities.length)));
			view.entities = [...view.entities, ...next];
			hasMore = next.length >= PAGE_SIZE;
		} catch (e) {
			error = (e as Error)?.message ?? 'Failed to load more entities';
		} finally {
			loadingMore = false;
		}
	}

	async function del(id: string) {
		await removeEntity(id);
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

	// No onMount load: the first page of rows was awaited during SSR above.
	// Searches run on Enter/Apply — typing only updates the URL, never the
	// results.

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

	<SectionTabs items={entityTabs} label="Entity views" />

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
