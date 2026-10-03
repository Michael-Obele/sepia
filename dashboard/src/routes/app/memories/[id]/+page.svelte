<script lang="ts">
	import { ArrowLeft, Pencil, Trash2, Archive, ArchiveRestore, Star } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { toast } from 'svelte-sonner';
	import { getMemoryDetailPage, removeMemory, updateMemoryData } from '$lib/remote/index.js';
	import { fresh } from '$lib/fresh.js';
	import { formatDate, importancePct, TYPE_BADGE } from '$lib/format.js';
	import { ALWAYS_TAG } from '@sepia/shared/types';
	import MemoryFormDialog from '$lib/components/memory-form-dialog.svelte';
	import ConfirmDeleteDialog from '$lib/components/confirm-delete-dialog.svelte';
	import { goto } from '$app/navigation';
	import { untrack } from 'svelte';
	import type { NamespaceStats } from '@sepia/shared';

	let { data, params } = $props();
	const isAuthed = () => Boolean(data.user);

	const memoryId = $derived(params.id);

	/** This page's view model: the memory (+ its entities) and the namespace options. */
	type MemoryDetail = Awaited<ReturnType<typeof getMemoryDetailPage>>['memory'];
	type DetailPage = { memory: MemoryDetail | null; namespaces: NamespaceStats[] };

	// AWAITED DURING SSR — see the note in `entities/+page.svelte`. ONE Neon HTTP
	// round trip carries the memory, its linked entities AND the namespace options,
	// and the result is serialised into the payload, so the browser makes no
	// initial data request.
	// `untrack` is deliberate: this is the INITIAL read of the route param, not a
	// subscription to it (a param change re-creates the component).
	const initialPage: DetailPage = isAuthed()
		? await getMemoryDetailPage(untrack(() => memoryId))
		: { memory: null, namespaces: [] };

	let view = $state<DetailPage>(initialPage);
	const namespaceList = $derived(view.namespaces.map((n) => n.name));

	// Render `view.memory` DIRECTLY — do NOT wrap it in a promise for `{#await}`:
	// a `$derived(Promise.resolve(x))` hands the block a NEW promise on every
	// re-evaluation, so it stays in its PENDING branch forever and the page shows
	// only a skeleton. See the note in `app/+page.svelte`.

	/** Re-read the memory after a mutation. */
	async function reload() {
		view = await fresh(getMemoryDetailPage(memoryId));
	}

	let showEdit = $state(false);

	// Delete confirmation — the dialog gates the actual delete.
	let pendingDelete = $state<{
		title: string;
		description: string;
		run: () => void | Promise<void>;
	} | null>(null);

	/** The memory object the edit dialog works on (mapped to entity_ids). */
	const editMemory = $derived.by(() => {
		const m = view.memory;
		if (!m) return null;
		return {
			id: m.id,
			content: m.content,
			type: m.type,
			importance: m.importance,
			namespace: m.namespace,
			tags: m.tags,
			entity_ids: m.entities.map((e) => String(e.id))
		};
	});

	async function del() {
		try {
			await removeMemory(params.id);
		} catch (e) {
			// Surface the gone/not-found state instead of pretending it worked;
			// rethrow so the confirm dialog shows the error toast.
			void reload();
			throw e;
		}
		toast.success('Memory deleted');
		goto('/app/memories');
	}

	async function toggleArchive(m: { archived: boolean | null }) {
		await updateMemoryData([params.id, { archived: !m.archived }]);
		toast.success(m.archived ? 'Restored from archive' : 'Archived');
		void reload();
	}

	/** Elevate ⇄ demote: flip `always` on this memory's OWN tag set (updates REPLACE tags). */
	async function toggleRule(m: { id: string; tags?: string[] | null }) {
		const tags = m.tags ?? [];
		const has = tags.includes(ALWAYS_TAG);
		await updateMemoryData([
			String(m.id),
			{ tags: has ? tags.filter((t) => t !== ALWAYS_TAG) : [...tags, ALWAYS_TAG] }
		]);
		toast.success(
			has ? 'Removed from the briefing' : 'Elevated to a standing rule — loads in every AI session'
		);
		void reload();
	}
</script>

<svelte:head><title>Sepia — Memory</title></svelte:head>

<div class="space-y-4">
	<Button variant="ghost" onclick={() => goto('/app/memories')} class="gap-1">
		<ArrowLeft class="size-4" /> Back to memories
	</Button>

	{#if view.memory}
		{@const m = view.memory}
		<Card>
			<CardHeader class="flex-row items-start justify-between gap-3">
				<div class="flex flex-wrap items-center gap-2">
					<Badge class={TYPE_BADGE[m.type as keyof typeof TYPE_BADGE] ?? ''}>{m.type}</Badge>
					<Badge variant="outline">{m.namespace}</Badge>
					{#if m.archived}
						<Badge variant="secondary">archived</Badge>
					{/if}
					{#if m.tags?.includes(ALWAYS_TAG)}
						<Badge>always</Badge>
					{/if}
				</div>
				<div class="flex gap-1">
					<Button
						variant="ghost"
						size="icon"
						onclick={() => void toggleRule(m)}
						aria-label={m.tags?.includes(ALWAYS_TAG) ? 'Remove from briefing' : 'Elevate to rule'}
						title={m.tags?.includes(ALWAYS_TAG)
							? 'Remove from the briefing'
							: 'Elevate to a standing rule'}
					>
						<Star class={m.tags?.includes(ALWAYS_TAG) ? 'size-4 fill-current' : 'size-4'} />
					</Button>
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
					<Button variant="ghost" size="icon" onclick={() => (showEdit = true)} aria-label="Edit">
						<Pencil class="size-4" />
					</Button>
					<Button
						variant="ghost"
						size="icon"
						onclick={() =>
							(pendingDelete = {
								title: 'Delete this memory?',
								description: 'This memory will be permanently lost. This cannot be undone.',
								run: del
							})}
						aria-label="Delete"
					>
						<Trash2 class="size-4 text-destructive" />
					</Button>
				</div>
			</CardHeader>
			<CardContent class="space-y-4">
				<p class="text-sm leading-relaxed whitespace-pre-wrap">{m.content}</p>

				<div class="grid gap-4 sm:grid-cols-3">
					<div>
						<p class="text-xs text-muted-foreground">Importance</p>
						<p class="text-sm font-medium">{importancePct(m.importance)}%</p>
					</div>
					<div>
						<p class="text-xs text-muted-foreground">Created</p>
						<p class="text-sm font-medium">{formatDate(m.createdAt)}</p>
					</div>
					<div>
						<p class="text-xs text-muted-foreground">Updated</p>
						<p class="text-sm font-medium">{formatDate(m.updatedAt)}</p>
					</div>
				</div>

				{#if m.entities.length > 0}
					<div>
						<p class="mb-2 text-xs text-muted-foreground">Linked entities</p>
						<div class="flex flex-wrap gap-2">
							{#each m.entities as e}
								<a href={`/app/entities/${e.id}`}>
									<Badge variant="outline" class="hover:bg-accent">{e.name}</Badge>
								</a>
							{/each}
						</div>
					</div>
				{/if}
			</CardContent>
		</Card>
	{/if}

	<MemoryFormDialog
		bind:open={showEdit}
		namespaces={namespaceList}
		memory={editMemory}
		onSaved={() => reload()}
	/>

	<ConfirmDeleteDialog
		open={pendingDelete !== null}
		onClose={() => (pendingDelete = null)}
		title={pendingDelete?.title ?? 'Delete this item?'}
		description={pendingDelete?.description ?? ''}
		onConfirm={pendingDelete?.run}
	/>
</div>
