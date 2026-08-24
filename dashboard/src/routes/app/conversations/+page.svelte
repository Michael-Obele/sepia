<script lang="ts">
	import {
		Plus,
		MessagesSquare,
		ExternalLink,
		ChevronRight,
		Trash2,
		CheckCircle2,
		PauseCircle,
		PlayCircle
	} from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { toast } from 'svelte-sonner';
	import { getMemories, getNamespaces, removeMemory, updateMemoryData } from '$lib/remote/index.js';
	import { auth, isAuthed } from '$lib/auth.svelte';
	import {
		timeAgo,
		truncate,
		sourceBadge,
		sourceAi,
		sourceRef,
		conversationTitle,
		conversationStatus,
		statusBadge,
		CONVERSATION_STATUSES
	} from '$lib/format.js';
	import ConversationFormDialog from '$lib/components/conversation-form-dialog.svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';

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
	let statusFilter = $state<'all' | 'active' | 'paused' | 'done'>('all');

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
		const filtered =
			statusFilter === 'all'
				? digests
				: digests.filter((d) => conversationStatus(d) === statusFilter);
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

	/** Set a conversation's status (metadata REPLACES — merge first). */
	async function setStatus(d: Digest, status: 'active' | 'paused' | 'done') {
		const meta = (d.metadata ?? {}) as Record<string, unknown>;
		await updateMemoryData([auth.token, String(d.id), { metadata: { ...meta, status } }]);
		toast.success(
			status === 'active' ? 'Resumed — this is the one to continue' : `Marked ${status}`
		);
		load();
	}

	function openConversation(conversationId: string) {
		goto(`/app/conversations/${encodeURIComponent(conversationId)}`);
	}

	async function del(id: string) {
		if (
			!confirm(
				'Delete this digest permanently? Constituent memories stay (they are regular memories).'
			)
		)
			return;
		await removeMemory([auth.token, id]);
		toast.success('Digest deleted');
		load();
	}

	// Open the create dialog when navigated with ?new=1
	$effect(() => {
		if (page.url.searchParams.get('new') === '1') {
			showCreate = true;
			history.replaceState(null, '', '/conversations');
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

	<!-- Status filter: which one to resume -->
	<div class="flex flex-wrap items-center gap-2">
		{#each ['all', ...CONVERSATION_STATUSES] as s (s)}
			<button
				type="button"
				onclick={() => (statusFilter = s as typeof statusFilter)}
				class={[
					'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
					statusFilter === s
						? 'border-primary bg-primary text-primary-foreground'
						: 'border-input bg-background text-muted-foreground hover:text-foreground'
				].join(' ')}
			>
				{s === 'all' ? 'All' : s}
			</button>
		{/each}
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
					<p class="font-medium">No conversations saved yet</p>
					<p class="text-sm text-muted-foreground">
						When an AI finishes a session, ask it to "save this conversation" — or distill one
						manually here.
					</p>
				</div>
				<Button variant="outline" onclick={() => (showCreate = true)}>
					<Plus class="size-4" /> Save a conversation
				</Button>
			</CardContent>
		</Card>
	{:else}
		<div class="space-y-4">
			{#each groups as group}
				<Card>
					<CardHeader class="pb-3">
						<div class="flex flex-wrap items-center justify-between gap-2">
							<CardTitle class="flex min-w-0 items-center gap-2 text-base">
								<MessagesSquare class="size-4 shrink-0 text-muted-foreground" />
								<button
									type="button"
									onclick={() => openConversation(group.id)}
									class="truncate font-semibold hover:underline"
									title="Open conversation"
								>
									{conversationTitle(group.items[0])}
								</button>
								<Badge class={statusBadge(conversationStatus(group.items[0]))}>
									{conversationStatus(group.items[0])}
								</Badge>
								<Badge variant="secondary"
									>{group.items.length} digest{group.items.length > 1 ? 's' : ''}</Badge
								>
							</CardTitle>
							<div class="flex items-center gap-2">
								<span class="font-mono text-xs text-muted-foreground">{group.id}</span>
								<span class="text-xs text-muted-foreground">
									{timeAgo(group.items[0].updatedAt)}
								</span>
								<Button variant="outline" size="sm" onclick={() => openConversation(group.id)}>
									Open <ChevronRight class="size-3.5" />
								</Button>
							</div>
						</div>
					</CardHeader>
					<CardContent class="space-y-3">
						{#each group.items as d}
							<div class="rounded-lg border p-3">
								<div class="mb-1.5 flex flex-wrap items-center gap-2">
									<Badge class={sourceBadge(sourceAi(d))}>{sourceAi(d)}</Badge>
									{#if Array.isArray(d.tags) && d.tags.length > 0}
										{#each d.tags.filter((t) => t !== 'conversation') as tag}
											<Badge variant="outline" class="text-xs">{tag}</Badge>
										{/each}
									{/if}
									{#if sourceRef(d)}
										<a
											href={sourceRef(d)}
											target="_blank"
											rel="noreferrer"
											class="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
										>
											source <ExternalLink class="size-3" />
										</a>
									{/if}
									<div class="ml-auto flex items-center gap-1.5">
										{#if conversationStatus(d) === 'active'}
											<Button
												variant="outline"
												size="sm"
												class="h-7 px-2 text-xs"
												onclick={() => setStatus(d, 'paused')}
											>
												<PauseCircle class="size-3.5" /> Pause
											</Button>
											<Button
												variant="secondary"
												size="sm"
												class="h-7 px-2 text-xs"
												onclick={() => setStatus(d, 'done')}
											>
												<CheckCircle2 class="size-3.5" /> Done
											</Button>
										{:else if conversationStatus(d) === 'paused'}
											<Button
												variant="outline"
												size="sm"
												class="h-7 px-2 text-xs"
												onclick={() => setStatus(d, 'active')}
											>
												<PlayCircle class="size-3.5" /> Resume
											</Button>
											<Button
												variant="secondary"
												size="sm"
												class="h-7 px-2 text-xs"
												onclick={() => setStatus(d, 'done')}
											>
												<CheckCircle2 class="size-3.5" /> Done
											</Button>
										{:else}
											<Button
												variant="outline"
												size="sm"
												class="h-7 px-2 text-xs"
												onclick={() => setStatus(d, 'active')}
											>
												<PlayCircle class="size-3.5" /> Undo done
											</Button>
										{/if}
										<button
											type="button"
											onclick={() => del(String(d.id))}
											class="inline-flex items-center rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
											aria-label="Delete digest"
										>
											<Trash2 class="size-3.5" />
										</button>
									</div>
								</div>
								<p class="text-sm whitespace-pre-wrap text-muted-foreground">
									{truncate(String(d.content), 400)}
								</p>
							</div>
						{/each}
					</CardContent>
				</Card>
			{/each}
		</div>
	{/if}
</div>

<!-- Drill-down is now a dedicated page: /app/conversations/[id] -->

<ConversationFormDialog bind:open={showCreate} namespaces={namespaceList} onSaved={load} />
