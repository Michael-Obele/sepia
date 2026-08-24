<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import {
		ArrowLeft,
		Copy,
		Trash2,
		LoaderCircle,
		ExternalLink,
		MessagesSquare,
		CheckCircle2,
		PauseCircle,
		PlayCircle
	} from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { toast } from 'svelte-sonner';
	import { getConversationData, getMemoryDetail, updateMemoryData, removeMemory } from '$lib/remote/index.js';
	import { auth, isAuthed } from '$lib/auth.svelte';
	import {
		timeAgo,
		formatDate,
		sourceBadge,
		sourceAi,
		sourceRef,
		TYPE_BADGE,
		conversationTitle,
		conversationStatus,
		statusBadge,
		type ConversationStatus
	} from '$lib/format.js';

	const conversationId = $derived(String(page.params.id));

	type ConvMemory = Awaited<ReturnType<typeof getConversationData>>[number];

	let memories = $state<ConvMemory[]>([]);
	let loading = $state(true);
	let error = $state('');

	/** The digest is the memory with metadata.kind === "conversation". */
	const digest = $derived(
		memories.find((m) => (m.metadata as Record<string, unknown> | null)?.kind === 'conversation')
	);
	/** Everything else — the evidence. */
	const constituents = $derived(memories.filter((m) => m.id !== digest?.id));

	const status = $derived(digest ? conversationStatus(digest) : 'active');
	const title = $derived(digest ? conversationTitle(digest) : conversationId);
	const transcript = $derived(
		digest ? (digest.metadata as Record<string, unknown> | null)?.transcript : undefined
	);

	/** Group constituents by memory type, in a stable order. */
	const sections = $derived.by(() => {
		const order: { type: string; label: string }[] = [
			{ type: 'fact', label: 'Decisions' },
			{ type: 'preference', label: 'Preferences' },
			{ type: 'instruction', label: 'Instructions' },
			{ type: 'observation', label: 'Observations & open questions' }
		];
		return order
			.map((s) => ({
				...s,
				items: constituents.filter((m) => m.type === s.type)
			}))
			.filter((s) => s.items.length > 0);
	});

	const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

	async function load() {
		loading = true;
		error = '';
		try {
			memories = await getConversationData([auth.token, conversationId]);
			// Fallback: a digest may lack conversation_id (older data or a
			// direct create) — if the param is a UUID, fetch the digest by id.
			if (memories.length === 0 && UUID_RE.test(conversationId)) {
				const m = await getMemoryDetail([auth.token, conversationId]);
				memories = [m as unknown as ConvMemory];
			}
		} catch (e) {
			error = (e as Error)?.message ?? 'Failed to load conversation';
		} finally {
			loading = false;
		}
	}

	/** Set the conversation status (metadata REPLACES — merge first). */
	async function setStatus(status: ConversationStatus) {
		if (!digest) return;
		const meta = (digest.metadata ?? {}) as Record<string, unknown>;
		await updateMemoryData([auth.token, String(digest.id), { metadata: { ...meta, status } }]);
		toast.success(
			status === 'active'
				? 'Marked active — this is the one to continue'
				: status === 'done'
					? 'Marked done'
					: 'Paused'
		);
		load();
	}

	/** Copy the digest markdown — paste it into the next AI to resume. */
	async function copyDigest() {
		if (!digest) return;
		try {
			await navigator.clipboard.writeText(String(digest.content));
			toast.success('Digest copied — paste it into the next AI to resume');
		} catch {
			toast.error('Could not copy to clipboard');
		}
	}

	async function del() {
		if (!digest) return;
		if (
			!confirm(
				'Delete this conversation digest permanently? Constituent memories stay (they are regular memories).'
			)
		)
			return;
		await removeMemory([auth.token, String(digest.id)]);
		toast.success('Conversation deleted');
		goto('/app/conversations');
	}

	$effect(() => {
		if (isAuthed()) load();
	});
</script>

<svelte:head><title>Sepia — {title}</title></svelte:head>

<div class="space-y-6">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div class="flex items-center gap-3">
			<Button
				variant="outline"
				size="sm"
				class="h-8 w-8 p-0"
				onclick={() => goto('/app/conversations')}
				aria-label="Back to conversations"
			>
				<ArrowLeft class="size-4" />
			</Button>
			<div>
				<h1 class="text-2xl font-semibold tracking-tight">{title}</h1>
				<p class="font-mono text-xs text-muted-foreground">{conversationId}</p>
			</div>
		</div>
		{#if digest}
			<div class="flex items-center gap-2">
				<Badge class={statusBadge(status)}>{status}</Badge>
				<Button variant="outline" size="sm" onclick={copyDigest}>
					<Copy class="size-3.5" /> Copy digest
				</Button>
				<Button variant="destructive" size="sm" onclick={del}>
					<Trash2 class="size-3.5" /> Delete
				</Button>
			</div>
		{/if}
	</div>

	{#if loading}
		<div class="flex justify-center py-16">
			<LoaderCircle class="size-6 animate-spin text-muted-foreground" />
		</div>
	{:else if error}
		<Card>
			<CardContent class="py-8 text-center text-sm text-destructive">{error}</CardContent>
		</Card>
	{:else if !digest}
		<Card>
			<CardContent class="flex flex-col items-center gap-3 py-12 text-center">
				<MessagesSquare class="size-8 text-muted-foreground" />
				<p class="font-medium">No digest found for this conversation</p>
				<p class="text-sm text-muted-foreground">
					It may have been deleted, or the conversation_id is wrong.
				</p>
				<Button variant="outline" onclick={() => goto('/app/conversations')}>
					Back to conversations
				</Button>
			</CardContent>
		</Card>
	{:else}
		<!-- Status controls: mark done / undone / pause / resume -->
		<Card>
			<CardContent class="flex flex-wrap items-center gap-2 py-3">
				<span class="text-sm text-muted-foreground">Status:</span>
				{#if status === 'active'}
					<Button variant="outline" size="sm" onclick={() => setStatus('paused')}>
						<PauseCircle class="size-3.5" /> Pause
					</Button>
					<Button variant="outline" size="sm" onclick={() => setStatus('done')}>
						<CheckCircle2 class="size-3.5" /> Mark done
					</Button>
				{:else if status === 'paused'}
					<Button variant="outline" size="sm" onclick={() => setStatus('active')}>
						<PlayCircle class="size-3.5" /> Resume
					</Button>
					<Button variant="outline" size="sm" onclick={() => setStatus('done')}>
						<CheckCircle2 class="size-3.5" /> Mark done
					</Button>
				{:else}
					<Button variant="outline" size="sm" onclick={() => setStatus('active')}>
						<PlayCircle class="size-3.5" /> Undo done
					</Button>
				{/if}
			</CardContent>
		</Card>

		<!-- Digest -->
		<Card>
			<CardHeader class="pb-3">
				<CardTitle class="flex flex-wrap items-center gap-2 text-base">
					<MessagesSquare class="size-4 text-muted-foreground" /> Digest
					<Badge class={sourceBadge(sourceAi(digest))}>{sourceAi(digest)}</Badge>
					{#if Array.isArray(digest.tags) && digest.tags.length > 0}
						{#each digest.tags.filter((t) => t !== 'conversation') as tag (tag)}
							<Badge variant="outline" class="text-xs">{tag}</Badge>
						{/each}
					{/if}
					<span class="ml-auto text-xs text-muted-foreground">
						{timeAgo(digest.updatedAt)} · {formatDate(digest.updatedAt)}
					</span>
				</CardTitle>
			</CardHeader>
			<CardContent class="space-y-3">
				<div class="rounded-lg border bg-muted/30 p-4">
					<p class="text-sm whitespace-pre-wrap">{digest.content}</p>
				</div>
				{#if sourceRef(digest)}
					<a
						href={sourceRef(digest)}
						target="_blank"
						rel="noreferrer"
						class="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
					>
						Original session <ExternalLink class="size-3" />
					</a>
				{/if}
				{#if typeof transcript === 'string' && transcript}
					<details class="rounded-lg border">
						<summary class="cursor-pointer px-3 py-2 text-sm font-medium">
							Verbatim transcript ({transcript.length.toLocaleString()} chars)
						</summary>
						<pre
							class="max-h-96 overflow-y-auto border-t p-3 text-xs whitespace-pre-wrap">{transcript}</pre>
					</details>
				{/if}
			</CardContent>
		</Card>

		<!-- Constituents grouped by type -->
		{#each sections as section (section.type)}
			<Card>
				<CardHeader class="pb-3">
					<CardTitle class="text-base">{section.label}</CardTitle>
				</CardHeader>
				<CardContent class="space-y-2">
					{#each section.items as m (m.id)}
						<div class="rounded-lg border p-3">
							<div class="mb-1.5 flex flex-wrap items-center gap-2">
								<Badge class={TYPE_BADGE[m.type as keyof typeof TYPE_BADGE] ?? TYPE_BADGE.fact}>
									{m.type}
								</Badge>
								{#if Array.isArray(m.tags) && m.tags.length > 0}
									{#each m.tags as tag (tag)}
										<Badge variant="outline" class="text-xs">{tag}</Badge>
									{/each}
								{/if}
								<span class="ml-auto text-xs text-muted-foreground">{timeAgo(m.updatedAt)}</span>
							</div>
							<p class="text-sm whitespace-pre-wrap">{m.content}</p>
						</div>
					{/each}
				</CardContent>
			</Card>
		{/each}
	{/if}
</div>
