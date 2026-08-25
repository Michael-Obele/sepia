<script lang="ts">
	import {
		Plus,
		MessagesSquare,
		ChevronRight,
		Trash2,
		CheckCircle2,
		PauseCircle,
		PlayCircle,
		Search,
		RotateCcw
	} from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Card, CardContent, CardHeader } from '$lib/components/ui/card/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { toast } from 'svelte-sonner';
	import { getMemories, getNamespaces, removeMemory, updateMemoryData } from '$lib/remote/index.js';
	import { auth, isAuthed } from '$lib/auth.svelte';
	import {
		timeAgo,
		sourceBadge,
		sourceAi,
		conversationTitle,
		conversationStatus,
		statusBadge,
		CONVERSATION_STATUSES
	} from '$lib/format.js';
	import ConversationFormDialog from '$lib/components/conversation-form-dialog.svelte';
	import ConfirmDeleteDialog from '$lib/components/confirm-delete-dialog.svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { useSearchParams } from 'runed/kit';
	import { conversationsSearchSchema, SEARCH_PARAMS_OPTIONS } from '$lib/search-params.js';
	import { onMount } from 'svelte';

	const namespaces = $derived(isAuthed() ? getNamespaces(auth.token) : null);
	let namespaceList = $state<string[]>([]);

	$effect(() => {
		namespaces?.then((ns) => {
			namespaceList = ns.map((n) => n.name);
		});
	});

	type Digest = Awaited<ReturnType<typeof getMemories>>[number];

	let digests = $state<Digest[]>([]);
	let loading = $state(true);
	let error = $state('');
	let showCreate = $state(false);

	// Delete confirmation — the dialog gates the actual delete.
	let pendingDelete = $state<{
		title: string;
		description: string;
		run: () => void | Promise<void>;
	} | null>(null);

	// URL-backed status filter — validated with valibot, restored on back/forward.
	const params = useSearchParams(conversationsSearchSchema, SEARCH_PARAMS_OPTIONS);
	const STATUS_OPTIONS = ['all', ...CONVERSATION_STATUSES] as const;

	// The applied text filter — only updates on Enter / Search click, so
	// typing never filters until you submit (same as the other routes).
	// Initialized from the URL on mount so a shared link resumes the search.
	let appliedQ = $state('');
	onMount(() => {
		appliedQ = params.q;
	});

	function submitSearch() {
		appliedQ = params.q;
	}

	async function load() {
		loading = true;
		error = '';
		try {
			// Real digests are auto-tagged `conversation` AND have
			// metadata.kind === "conversation" — filter out regular memories
			// that merely carry the tag.
			digests = (await getMemories([auth.token, { tags: ['conversation'], limit: 50 }])).filter(
				(d) => (d.metadata as Record<string, unknown> | null)?.kind === 'conversation'
			);
		} catch (e) {
			error = (e as Error)?.message ?? 'Failed to load conversations';
		} finally {
			loading = false;
		}
	}

	/** Group digests by conversation_id, most recent first. */
	const groups = $derived.by(() => {
		// Client-side filter: status + applied name search (title,
		// conversation_id, or content).
		const q = appliedQ.trim().toLowerCase();
		const filtered = digests.filter((d) => {
			if (params.status !== 'all' && conversationStatus(d) !== params.status) return false;
			if (!q) return true;
			const meta = d.metadata as Record<string, unknown> | null | undefined;
			const cid = typeof meta?.conversation_id === 'string' ? meta.conversation_id : '';
			return (
				conversationTitle(d).toLowerCase().includes(q) ||
				cid.toLowerCase().includes(q) ||
				String(d.content ?? '')
					.toLowerCase()
					.includes(q)
			);
		});
		const map = new Map<string, Digest[]>();
		for (const d of filtered) {
			const meta = d.metadata as Record<string, unknown> | null | undefined;
			// Group by conversation_id; fall back to the digest's own id so
			// digests without a conversation_id still open correctly.
			const cid =
				typeof meta?.conversation_id === 'string' && meta.conversation_id
					? meta.conversation_id
					: String(d.id);
			const list = map.get(cid) ?? [];
			list.push(d);
			map.set(cid, list);
		}
		return [...map.entries()]
			.map(([id, items]) => ({
				id,
				items: items.sort(
					(a, b) =>
						new Date(String(b.updatedAt)).getTime() - new Date(String(a.updatedAt)).getTime()
				)
			}))
			.sort(
				(a, b) =>
					new Date(String(b.items[0].updatedAt)).getTime() -
					new Date(String(a.items[0].updatedAt)).getTime()
			);
	});

	/** Set a conversation's status — applies to every digest in the group. */
	async function setStatus(group: { items: Digest[] }, status: 'active' | 'paused' | 'done') {
		await Promise.all(
			group.items.map(async (d) => {
				const meta = (d.metadata ?? {}) as Record<string, unknown>;
				await updateMemoryData([auth.token, String(d.id), { metadata: { ...meta, status } }]);
			})
		);
		toast.success(
			status === 'active' ? 'Resumed — this is the one to continue' : `Marked ${status}`
		);
		load();
	}

	function openConversation(conversationId: string) {
		goto(`/app/conversations/${encodeURIComponent(conversationId)}`);
	}

	/** Delete the whole conversation — every digest in the group. */
	async function delConversation(group: { items: Digest[] }) {
		await Promise.all(group.items.map((d) => removeMemory([auth.token, String(d.id)])));
		toast.success('Conversation deleted');
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

	// Initial load
	$effect(() => {
		load();
	});
</script>

<svelte:head><title>Sepia — Conversations</title></svelte:head>

<div class="space-y-6">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<h1 class="text-2xl font-semibold tracking-tight">Conversations</h1>
			<p class="text-sm text-muted-foreground">
				Handoff digests — distilled conversations that survive migration between AIs.
			</p>
		</div>
		<Button onclick={() => (showCreate = true)}>
			<Plus class="size-4" /> Save conversation
		</Button>
	</div>

	<!-- Search by name + status filter -->
	<div class="flex flex-col gap-3">
		<div class="flex min-w-0 flex-col gap-2 sm:flex-row">
			<div class="relative min-w-0 flex-1">
				<Search
					class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
				/>
				<Input
					bind:value={params.q}
					placeholder="Search by name…"
					class="w-full pl-9"
					aria-label="Search conversations by name"
					onkeydown={(e) => {
						if (e.key === 'Enter') submitSearch();
					}}
				/>
			</div>
			<Button onclick={submitSearch}>
				<Search class="size-4" /> Search
			</Button>
		</div>
		<div class="flex flex-wrap items-center gap-2">
			{#each STATUS_OPTIONS as s (s)}
				<button
					type="button"
					onclick={() => (params.status = s)}
					class={[
						'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
						params.status === s
							? 'border-primary bg-primary text-primary-foreground'
							: 'border-input bg-background text-muted-foreground hover:text-foreground'
					].join(' ')}
				>
					{s === 'all' ? 'All' : s}
				</button>
			{/each}
			<Button
				variant="outline"
				size="sm"
				class="h-7 px-2 text-xs"
				onclick={() => {
					params.reset();
					appliedQ = '';
				}}
				aria-label="Reset filters"
			>
				<RotateCcw class="size-3.5" /> Reset
			</Button>
		</div>
	</div>

	{#if loading}
		<div class="space-y-3">
			{#each Array(3) as _, i (i)}
				<Skeleton class="h-28 w-full" />
			{/each}
		</div>
	{:else if error}
		<Card>
			<CardContent class="py-8 text-center text-sm text-destructive">{error}</CardContent>
		</Card>
	{:else if groups.length === 0}
		<Card>
			<CardContent class="flex flex-col items-center gap-3 py-12 text-center">
				<MessagesSquare class="size-8 text-muted-foreground" />
				<div>
					<p class="font-medium">
						{digests.length > 0
							? 'No conversations match your search'
							: 'No conversations saved yet'}
					</p>
					<p class="text-sm text-muted-foreground">
						{digests.length > 0
							? 'Try a different name or clear the filters.'
							: 'When an AI finishes a session, ask it to "save this conversation" — or distill one manually here.'}
					</p>
				</div>
				{#if digests.length > 0}
					<Button
						variant="outline"
						onclick={() => {
							params.reset();
							appliedQ = '';
						}}
					>
						<RotateCcw class="size-4" /> Clear filters
					</Button>
				{:else}
					<Button variant="outline" onclick={() => (showCreate = true)}>
						<Plus class="size-4" /> Save a conversation
					</Button>
				{/if}
			</CardContent>
		</Card>
	{:else}
		<div class="space-y-4">
			{#each groups as group (group.id)}
				<Card>
					<CardHeader class="pb-3">
						<!-- Badges row: top of the card, wraps on narrow screens -->
						<div class="flex flex-wrap items-center gap-2">
							<Badge class={statusBadge(conversationStatus(group.items[0]))}>
								{conversationStatus(group.items[0])}
							</Badge>
							<Badge variant="secondary"
								>{group.items.length} digest{group.items.length > 1 ? 's' : ''}</Badge
							>
							<Badge class={sourceBadge(sourceAi(group.items[0]))}>
								{sourceAi(group.items[0])}
							</Badge>
							<span class="ml-auto font-mono text-xs text-muted-foreground">{group.id}</span>
							<span class="text-xs text-muted-foreground">
								{timeAgo(group.items[0].updatedAt)}
							</span>
						</div>
						<!-- Title row: wraps below the badges -->
						<div class="mt-2 flex items-start justify-between gap-2">
							<button
								type="button"
								onclick={() => openConversation(group.id)}
								class="min-w-0 flex-1 text-left text-base font-semibold wrap-break-word hover:underline"
								title="Open conversation"
							>
								<MessagesSquare class="mr-1.5 inline size-4 shrink-0 text-muted-foreground" />
								{conversationTitle(group.items[0])}
							</button>
							<Button
								variant="outline"
								size="sm"
								class="shrink-0"
								onclick={() => openConversation(group.id)}
							>
								Open <ChevronRight class="size-3.5" />
							</Button>
						</div>
					</CardHeader>
					<CardContent class="space-y-3">
						<!-- Preview: the latest digest, a few lines. Full detail lives on the
						     conversation page, where every digest + connection is visible. -->
						<p class="line-clamp-2 text-sm text-muted-foreground">
							{String(group.items[0].content)}
						</p>
						<div class="flex flex-wrap items-center gap-1.5">
							{#if conversationStatus(group.items[0]) === 'active'}
								<Button
									variant="outline"
									size="sm"
									class="h-7 px-2 text-xs"
									onclick={() => setStatus(group, 'paused')}
								>
									<PauseCircle class="size-3.5" /> Pause
								</Button>
								<Button
									variant="secondary"
									size="sm"
									class="h-7 px-2 text-xs"
									onclick={() => setStatus(group, 'done')}
								>
									<CheckCircle2 class="size-3.5" /> Done
								</Button>
							{:else if conversationStatus(group.items[0]) === 'paused'}
								<Button
									variant="outline"
									size="sm"
									class="h-7 px-2 text-xs"
									onclick={() => setStatus(group, 'active')}
								>
									<PlayCircle class="size-3.5" /> Resume
								</Button>
								<Button
									variant="secondary"
									size="sm"
									class="h-7 px-2 text-xs"
									onclick={() => setStatus(group, 'done')}
								>
									<CheckCircle2 class="size-3.5" /> Done
								</Button>
							{:else}
								<Button
									variant="outline"
									size="sm"
									class="h-7 px-2 text-xs"
									onclick={() => setStatus(group, 'active')}
								>
									<PlayCircle class="size-3.5" /> Undo done
								</Button>
							{/if}
							<Button
								variant="ghost"
								size="sm"
								class="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
								onclick={() =>
									(pendingDelete = {
										title: 'Delete this conversation?',
										description: `${group.items.length} digest${group.items.length > 1 ? 's' : ''} will be permanently lost. Constituent memories stay (they are regular memories).`,
										run: () => delConversation(group)
									})}
							>
								<Trash2 class="size-3.5" /> Delete
							</Button>
						</div>
					</CardContent>
				</Card>
			{/each}
		</div>
	{/if}
</div>

<!-- Drill-down is now a dedicated page: /app/conversations/[id] -->

<ConversationFormDialog bind:open={showCreate} namespaces={namespaceList} onSaved={load} />

<ConfirmDeleteDialog
	open={pendingDelete !== null}
	onClose={() => (pendingDelete = null)}
	title={pendingDelete?.title ?? 'Delete this item?'}
	description={pendingDelete?.description ?? ''}
	onConfirm={pendingDelete?.run}
/>
