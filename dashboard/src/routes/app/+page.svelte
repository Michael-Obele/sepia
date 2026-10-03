<script lang="ts">
	import {
		Search,
		Plus,
		Clock,
		LoaderCircle,
		RotateCcw,
		MessagesSquare,
		Boxes,
		Layers,
		X,
		Trash2,
		Plug,
		TriangleAlert
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
	import * as Alert from '$lib/components/ui/alert/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import { toast } from 'svelte-sonner';
	import { getHomePage, searchAll, removeMemory } from '$lib/remote/index.js';
	import { fresh } from '$lib/fresh.js';
	import type { NamespaceStats, PlanLimits, Stats } from '@sepia/shared';
	import { timeAgo, importancePct, TYPE_BADGE, truncate } from '$lib/format.js';
	import { goto } from '$app/navigation';
	import { useSearchParams } from 'runed/kit';
	import { appSearchSchema, SEARCH_PARAMS_OPTIONS } from '$lib/search-params.js';
	import ConfirmDeleteDialog from '$lib/components/confirm-delete-dialog.svelte';

	let { data } = $props();
	const isAuthed = () => Boolean(data.user);

	/** This page's view model. `stats` is null only for an anonymous visitor,
	 *  whom the root layout renders as the sign-in form instead. */
	type Overview = {
		stats: Stats | null;
		namespaces: NamespaceStats[];
		/** Plan limits, computed on the SERVER — see the note in `home.remote.ts`. */
		limits: PlanLimits | null;
	};

	// AWAITED DURING SSR — see the note in `entities/+page.svelte`. ONE Neon HTTP
	// round trip carries the 11 stat statements AND the namespace options, and the
	// result is serialised into the page payload, so the browser makes no initial
	// data request. This replaces three separate remote calls (stats, namespaces
	// and getMe), each of which paid its own invocation and session lookup.
	const initialPage: Overview = isAuthed()
		? await getHomePage()
		: { stats: null, namespaces: [], limits: null };

	let view = $state<Overview>(initialPage);

	// The markup renders `view` DIRECTLY — do NOT wrap these in a promise for an
	// `{#await}` block. A `$derived(Promise.resolve(x))` hands `{#await}` a NEW
	// promise on every re-evaluation, so the block never leaves its PENDING branch
	// and the page shows skeletons forever. Measured 2026-10-03: `/app`,
	// `/briefing` and `/settings/data` all rendered nothing but a skeleton because
	// of exactly this. The data is already resolved; render it.

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
			const res = await searchAll({
				q,
				namespace: ns === 'all' ? undefined : ns,
				limit: 10
			});
			if (seq !== searchSeq) return;
			results = res;
		} finally {
			if (seq === searchSeq) searching = false;
		}
	}

	// Resume: if the URL carries a committed query on load, run it once.
	$effect(() => {
		if (params.q.trim() !== '' || params.namespace !== 'all') {
			void doSearch(params.q, params.namespace);
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

	function resultHref(r: { kind: string; id: string }) {
		return r.kind === 'entity' ? `/app/entities/${r.id}` : `/app/memories/${r.id}`;
	}

	// Delete confirmation — the dialog gates the actual delete.
	let pendingDelete = $state<{
		title: string;
		description: string;
		run: () => void | Promise<void>;
	} | null>(null);

	async function deleteRecent(id: string) {
		await removeMemory(id);
		toast.success('Memory deleted');
		view = await fresh(getHomePage());
	}

	/**
	 * The one thing Overview tells you that a list would not: that you are
	 * close to a limit and writes are about to pause. Typed as a union so a
	 * second case (an expired Web AI connection) can be added later without
	 * reshaping the markup below.
	 */
	type OverviewAlert = {
		kind: 'memory-limit';
		used: number;
		limit: number;
		pct: number;
	};

	/** The nudge starts at 80% — matches the pricing page's copy. */
	const ALERT_AT_PCT = 80;

	const alert = $derived.by<OverviewAlert | null>(() => {
		if (!view.stats || !view.limits) return null;
		// The limit comes from the server (`view.limits`) rather than
		// `getPlanLimits` here: value-importing the shared barrel into a component
		// pulls `node:crypto` into the client bundle and breaks this page.
		const limit = view.limits.maxMemories;
		const pct = Math.round((view.stats.memories / limit) * 100);
		if (pct < ALERT_AT_PCT) return null;
		return { kind: 'memory-limit', used: view.stats.memories, limit, pct };
	});

	// Dismissal is deliberately NOT persisted: the limit is still there on the
	// next visit, and a stale dismissal would hide a real warning forever.
	let alertDismissed = $state(false);
</script>

<svelte:head><title>Overview — Sepia</title></svelte:head>

<div class="max-w-full min-w-0 space-y-6 overflow-hidden">
	<div class="flex flex-col gap-2">
		<h1 class="text-2xl font-semibold tracking-tight">Overview</h1>
		<p class="text-sm text-muted-foreground">
			Search everything your AI agents have stored — memories, entities, and relations.
		</p>
	</div>

	<!--
		Two layouts from one page, keyed on whether there is anything to search.
		A new account has nothing to explore, so it gets one instruction; a
		populated account gets its search and its counts. The alert strip is
		only rendered while it is actionable.
	-->
	{#if view.stats}
		{@const s = view.stats}
		{#if s.memories === 0 && s.entities === 0 && s.conversations === 0}
			<!-- First run. Research is consistent on one thing here: a
				     first-run screen with several CTAs gets none of them clicked.
				     One action, and everything else explains or points at it. -->
			<Card>
				<CardHeader>
					<CardTitle class="text-base">Nothing stored yet</CardTitle>
					<CardDescription>
						Sepia is one memory graph that every AI you use reads and writes. Point an AI at it and
						it starts remembering — no setup in the AI beyond pasting a URL.
					</CardDescription>
				</CardHeader>
				<CardContent class="space-y-4">
					<ol class="space-y-1.5 text-sm text-muted-foreground">
						<li class="flex gap-2">
							<span class="font-medium text-foreground">1.</span>
							Pick your AI — ChatGPT, Claude, Grok, Gemini, Perplexity.
						</li>
						<li class="flex gap-2">
							<span class="font-medium text-foreground">2.</span>
							Paste the MCP URL and authorize it.
						</li>
						<li class="flex gap-2">
							<span class="font-medium text-foreground">3.</span>
							Ask it something. Come back and search what it kept.
						</li>
					</ol>
					<div class="flex flex-wrap items-center gap-2">
						<Button onclick={() => goto('/app/connect')} class="gap-1.5">
							<Plug class="size-4" /> Connect an AI
						</Button>
						<code class="rounded-md bg-muted px-2 py-1 font-mono text-xs"
							>https://sepia.fly.dev/mcp</code
						>
					</div>
				</CardContent>
			</Card>
		{:else}
			{#if alert && !alertDismissed}
				<Alert.Root>
					<TriangleAlert />
					<Alert.Title>You’re at {alert.pct}% of your memory limit</Alert.Title>
					<Alert.Description>
						{alert.used.toLocaleString()} of {alert.limit.toLocaleString()} memories. Reading, searching
						and export keep working — only new writes pause.
						<a href="/app/settings/plan" class="font-medium underline underline-offset-4"
							>See your plan</a
						>
					</Alert.Description>
					<button
						type="button"
						onclick={() => (alertDismissed = true)}
						class="absolute top-2 right-2 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
						aria-label="Dismiss this warning"
						title="Dismiss"
					>
						<X class="size-4" />
					</button>
				</Alert.Root>
			{/if}

			<!-- Search first: it is the one task that justifies this page. -->
			<Card>
				<CardHeader>
					<CardTitle class="text-base">Search</CardTitle>
					<CardDescription>Same engine as the MCP search tool.</CardDescription>
				</CardHeader>
				<CardContent class="min-w-0 space-y-3 overflow-hidden">
					<div class="flex min-w-0 flex-col gap-2 sm:flex-row">
						<div class="relative min-w-0 flex-1">
							<Search
								class="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
							/>
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
							{#if view.namespaces.length}
								{#each view.namespaces as n (n.name)}
									<option value={n.name}>{n.name}</option>
								{/each}
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
											<p class="min-w-0 text-sm font-medium wrap-break-word">
												{r.kind === 'entity' ? r.name : truncate(r.content ?? '', 120)}
											</p>
											<p class="min-w-0 truncate text-xs text-muted-foreground">
												{r.kind === 'memory' ? truncate(r.content ?? '', 200) : r.snippet}
											</p>
										</div>
										<div class="flex shrink-0 flex-col items-end gap-1">
											<Badge class={TYPE_BADGE[r.type as keyof typeof TYPE_BADGE] ?? ''}
												>{r.type}</Badge
											>
											<span class="text-xs text-muted-foreground"
												>{importancePct(r.importance)}%</span
											>
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
			</div>

			<!-- Just added -->
			{#if s.recent_memories.length > 0}
				<Card>
					<CardHeader class="pb-3">
						<CardTitle class="flex items-center gap-2 text-base">
							<Clock class="size-4" /> Just added
						</CardTitle>
						<CardDescription>Most recently updated across all namespaces.</CardDescription>
					</CardHeader>
					<CardContent class="space-y-3">
						{#each s.recent_memories as m (m.id)}
							<div
								class="group flex min-w-0 items-start gap-2 rounded-md p-2 transition-colors hover:bg-accent"
							>
								<a href={`/app/memories/${m.id}`} class="block min-w-0 flex-1 overflow-hidden">
									<div class="flex min-w-0 items-start justify-between gap-3 overflow-hidden">
										<p class="min-w-0 flex-1 text-sm wrap-break-word">
											{truncate(m.content, 200)}
										</p>
										<span class="shrink-0 text-xs text-muted-foreground"
											>{timeAgo(m.updated_at)}</span
										>
									</div>
									<div class="mt-1 flex flex-wrap items-center gap-2">
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

			<!-- One line of counts, each linking to its list. The full figures
				     live in Settings → Plan & usage. -->
			<p class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
				<a href="/app/memories" class="inline-flex items-center gap-1 hover:text-foreground">
					<Layers class="size-3.5" />
					{s.memories.toLocaleString()} memories
				</a>
				<span aria-hidden="true">·</span>
				<a href="/app/entities" class="inline-flex items-center gap-1 hover:text-foreground">
					<Boxes class="size-3.5" />
					{s.entities.toLocaleString()} entities
				</a>
				<span aria-hidden="true">·</span>
				<a href="/app/conversations" class="inline-flex items-center gap-1 hover:text-foreground">
					<MessagesSquare class="size-3.5" />
					{s.conversations.toLocaleString()} conversations
				</a>
			</p>
		{/if}
	{/if}

	<ConfirmDeleteDialog
		open={pendingDelete !== null}
		onClose={() => (pendingDelete = null)}
		title={pendingDelete?.title ?? 'Delete this item?'}
		description={pendingDelete?.description ?? ''}
		onConfirm={pendingDelete?.run}
	/>
</div>
