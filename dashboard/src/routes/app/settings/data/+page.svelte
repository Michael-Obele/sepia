<script lang="ts">
	import {
		Download,
		FileJson,
		FileText,
		RefreshCw,
		Activity,
		SearchX,
		Trash2
	} from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { ScrollArea } from '$lib/components/ui/scroll-area/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { toast } from 'svelte-sonner';
	import {
		exportAll,
		getStatsData,
		runPruneMemories,
		eraseTelemetry,
		getTelemetryEvents,
		getTelemetryFailures,
		getTelemetryReport
	} from '$lib/remote/index.js';
	import ConfirmDeleteDialog from '$lib/components/confirm-delete-dialog.svelte';

	let { data } = $props();
	const isAuthed = () => Boolean(data.user);

	const stats = $derived(isAuthed() ? getStatsData() : null);
	const report = $derived(isAuthed() ? getTelemetryReport() : null);
	const events = $derived(isAuthed() ? getTelemetryEvents(50) : null);
	const failures = $derived(isAuthed() ? getTelemetryFailures(25) : null);

	let exporting = $state(false);
	let erasing = $state(false);
	let confirmErase = $state(false);

	function pct(n: number, of: number): string {
		if (!of) return '—';
		return `${Math.round((n / of) * 100)}%`;
	}

	async function pruneMemories() {
		const res = await runPruneMemories({ confirm: true });
		toast.success('Memories pruned', {
			description: `${res.archived_stale} stale, ${res.archived_duplicates} duplicates archived, ${res.purged} purged`
		});
		stats?.refresh();
	}

	// DISPOSITION 10: a destructive sweep behind a bare button — route it
	// through the same ConfirmDeleteDialog every other delete uses. The copy is
	// the wording the sweep has always shipped with; see
	// packages/shared/src/db/lib/prune.ts for the actual rule.
	let pendingDelete = $state<{
		title: string;
		description: string;
		run: () => void | Promise<void>;
	} | null>(null);

	function confirmPrune() {
		pendingDelete = {
			title: 'Prune memories?',
			description:
				'Archives stale and duplicate memories, then permanently purges anything archived over 30 days.',
			run: pruneMemories
		};
	}

	async function downloadJson() {
		exporting = true;
		try {
			const data = await exportAll();
			const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `sepia-export-${new Date().toISOString().slice(0, 10)}.json`;
			a.click();
			URL.revokeObjectURL(url);
			toast.success('JSON export downloaded');
		} catch (e) {
			toast.error((e as Error)?.message ?? 'Export failed');
		} finally {
			exporting = false;
		}
	}

	async function downloadMarkdown() {
		exporting = true;
		try {
			const data = await exportAll();
			let md = `# Sepia Memory Export\n\n_Generated ${new Date().toISOString()}_\n\n`;
			for (const ns of data.namespaces) {
				md += `\n## Namespace: ${ns.name}\n\n`;
				md += `Entities: ${ns.entity_count} · Memories: ${ns.memory_count} · Relations: ${ns.relation_count}\n\n`;
				const nsEntities = data.entities.filter((e) => e.namespace === ns.name);
				if (nsEntities.length) {
					md += `### Entities\n\n`;
					for (const e of nsEntities) {
						md += `- **${e.name}** (${e.type}, importance ${Math.round((e.importance ?? 0.5) * 100)}%)\n`;
						if (e.summary) md += `  - ${e.summary}\n`;
					}
					md += '\n';
				}
				const nsMemories = data.memories.filter((m) => m.namespace === ns.name);
				if (nsMemories.length) {
					md += `### Memories\n\n`;
					for (const m of nsMemories) {
						md += `- [${m.type}] ${m.content}\n`;
					}
					md += '\n';
				}
			}
			const blob = new Blob([md], { type: 'text/markdown' });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `sepia-export-${new Date().toISOString().slice(0, 10)}.md`;
			a.click();
			URL.revokeObjectURL(url);
			toast.success('Markdown export downloaded');
		} catch (e) {
			toast.error((e as Error)?.message ?? 'Export failed');
		} finally {
			exporting = false;
		}
	}

	async function runErase() {
		confirmErase = false;
		erasing = true;
		try {
			// The form's default behaviour — invalidating every query on success —
			// replaces the manual report/events refreshes this used to do.
			const ok = await eraseTelemetry.submit();
			if (ok) {
				const deleted = eraseTelemetry.result ?? 0;
				toast.success(`Erased ${deleted} telemetry ${deleted === 1 ? 'row' : 'rows'}`, {
					description:
						'The setting is unchanged — turn telemetry off on the Preferences page if you want it to stop collecting.'
				});
			}
		} catch (e) {
			toast.error((e as Error)?.message ?? 'Could not erase telemetry');
		} finally {
			erasing = false;
		}
	}

	const fmt = (v: string | null) => (v ? new Date(v).toLocaleString() : '—');
</script>

<div class="space-y-6">
	<Card.Root>
		<Card.Header>
			<Card.Title class="flex items-center gap-2 text-base">
				<Download class="size-4" /> Data export
			</Card.Title>
			<Card.Description>
				Download everything in memory as JSON or human-readable Markdown.
			</Card.Description>
		</Card.Header>
		<Card.Content class="flex flex-wrap gap-2">
			<Button variant="outline" onclick={downloadJson} disabled={exporting} class="gap-1">
				<FileJson class="size-4" /> Export JSON
			</Button>
			<Button variant="outline" onclick={downloadMarkdown} disabled={exporting} class="gap-1">
				<FileText class="size-4" /> Export Markdown
			</Button>
		</Card.Content>
	</Card.Root>

	<!-- The destructive bulk sweep, next to the number it would act on. A
	     sweep is not a peer of "create", so it does not live on Overview. -->
	<Card.Root>
		<Card.Header>
			<Card.Title class="flex items-center gap-2 text-base">
				<RefreshCw class="size-4" /> Decay sweep
			</Card.Title>
			<Card.Description>
				Archive anything that has gone stale or turned up a duplicate, then purge what has been
				archived past its window.
			</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-3">
			{#if stats}
				{#await stats}
					<Skeleton class="h-6 w-48" />
				{:then s}
					<p class="text-sm">
						<span class="font-semibold tabular-nums">{s.decay_candidates}</span>
						<span class="text-muted-foreground"> memories will be archived </span>
					</p>
				{:catch e}
					<p class="text-sm text-destructive">
						{(e as Error)?.message ?? 'Failed to load decay candidates'}
					</p>
				{/await}
			{/if}
			<Button variant="outline" onclick={confirmPrune} class="gap-1">
				<RefreshCw class="size-4" /> Prune memories
			</Button>
		</Card.Content>
	</Card.Root>

	<!-- Transparency viewer: the owner sees the rows themselves. -->
	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Stored telemetry rows</Card.Title>
			<Card.Description>The 50 most recent, exactly as they sit in your database.</Card.Description>
		</Card.Header>
		<Card.Content>
			{#if events}
				{#await events}
					<div class="space-y-2">
						{#each [0, 1, 2] as i (i)}<Skeleton class="h-12 w-full" />{/each}
					</div>
				{:then rows}
					{#if rows.length === 0}
						<p class="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
							No rows stored for this account.
						</p>
					{:else}
						<ScrollArea class="h-80 rounded-lg border">
							<ul class="divide-y">
								{#each rows as row (row.id)}
									<li class="space-y-1 p-3">
										<div class="flex flex-wrap items-center gap-2 text-xs">
											<span class="font-mono text-[11px] text-muted-foreground"
												>{fmt(row.createdAt)}</span
											>
											<Badge variant="secondary" class="font-mono text-[10px]">
												{row.tool}{row.action ? `/${row.action}` : ''}
											</Badge>
											{#if row.engine}
												<Badge variant="outline" class="font-mono text-[10px]">{row.engine}</Badge>
											{/if}
											{#if row.hitCount !== null}
												<span class="text-muted-foreground tabular-nums">
													{row.hitCount} hits · {row.bestMatchedTerms ?? '—'}/{row.terms ?? '—'} terms
													·
													{row.latencyMs ?? '—'}ms
												</span>
											{/if}
										</div>
										{#if row.queryText}
											<p class="font-mono text-[11px] wrap-break-word">{row.queryText}</p>
										{/if}
									</li>
								{/each}
							</ul>
						</ScrollArea>
					{/if}
				{:catch e}
					<p class="text-sm text-destructive">
						{(e as Error)?.message ?? 'Failed to load stored rows'}
					</p>
				{/await}
			{/if}
		</Card.Content>
	</Card.Root>

	<!-- Summary -->
	<Card.Root>
		<Card.Header>
			<Card.Title class="flex items-center gap-2 text-base">
				<Activity class="size-4" />
				Last 30 days
			</Card.Title>
			<Card.Description>
				Counts, not conclusions. Where an outcome cannot be attributed, it says so instead of
				guessing.
			</Card.Description>
		</Card.Header>
		<Card.Content>
			{#if report}
				{#await report}
					<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
						{#each [0, 1, 2, 3] as i (i)}<Skeleton class="h-20 w-full" />{/each}
					</div>
				{:then r}
					{#if r.tier === 'off' && r.events === 0}
						<p class="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
							Nothing recorded. Turn telemetry on under
							<a href="/app/settings/preferences" class="underline underline-offset-2"
								>Preferences</a
							> if you want to see what this would show.
						</p>
					{:else}
						<div class="space-y-4">
							<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
								<div class="rounded-lg border p-4">
									<div class="text-2xl font-semibold tabular-nums">{r.searches}</div>
									<div class="text-xs text-muted-foreground">Searches</div>
								</div>
								<div class="rounded-lg border p-4">
									<div class="text-2xl font-semibold tabular-nums">{r.zero_result}</div>
									<div class="text-xs text-muted-foreground">
										Came back empty <span class="tabular-nums"
											>({pct(r.zero_result, r.searches)})</span
										>
									</div>
									<div class="text-[11px] text-muted-foreground tabular-nums">
										bare {r.zero_bare} · precision {r.zero_precision} · filtered {r.zero_filtered}{r.zero_unknown
											? ` · unclassifiable ${r.zero_unknown}`
											: ''}
									</div>
								</div>
								<div class="rounded-lg border p-4">
									<div class="text-2xl font-semibold tabular-nums">{r.repeated}</div>
									<div class="text-xs text-muted-foreground">Asked again in the same session</div>
								</div>
								<div class="rounded-lg border p-4">
									<div class="text-2xl font-semibold tabular-nums">{r.latency_ms.p50 ?? '—'}</div>
									<div class="text-xs text-muted-foreground">
										Median ms <span class="tabular-nums">(p95 {r.latency_ms.p95 ?? '—'})</span>
									</div>
								</div>
							</div>

							<dl class="space-y-1 text-xs text-muted-foreground">
								<div class="flex flex-wrap gap-x-2">
									<dt>Outcome known for</dt>
									<dd class="text-foreground tabular-nums">
										{r.correlated_searches} of {r.searches} searches ({pct(
											r.correlated_searches,
											r.searches
										)})
									</dd>
								</div>
								<div class="flex flex-wrap gap-x-2">
									<dt>Chained — another search within 120 s</dt>
									<dd class="text-foreground tabular-nums">
										{r.reformulated} ({pct(r.reformulated, r.correlated_searches)} of attributable searches)
										<span class="text-muted-foreground">— context, not a failure rate</span>
									</dd>
								</div>
								<div class="flex flex-wrap gap-x-2">
									<dt>Retried after an empty result</dt>
									<dd class="text-foreground tabular-nums">
										{r.retried_after_zero} ({pct(r.retried_after_zero, r.correlated_searches)} of attributable
										searches)
										<span class="text-muted-foreground">— the real “that didn’t work” signal</span>
									</dd>
								</div>
								<div class="flex flex-wrap gap-x-2">
									<dt>Out of page</dt>
									<dd class="text-foreground tabular-nums">
										{r.truncated} ({pct(r.truncated, r.searches)}) filled the requested page — more
										existed
									</dd>
								</div>
								<div class="flex flex-wrap gap-x-2">
									<dt>Coverage</dt>
									<dd class="text-foreground tabular-nums">
										avg {r.avg_coverage ?? '—'} · full {r.full_coverage}/{r.coveraged_searches} ({pct(
											r.full_coverage,
											r.coveraged_searches
										)})
									</dd>
								</div>
								<div class="flex flex-wrap gap-x-2">
									<dt>Distinct queries</dt>
									<dd class="text-foreground tabular-nums">{r.distinct_queries}</dd>
								</div>
								<div class="flex flex-wrap gap-x-2">
									<dt>Briefing</dt>
									<dd class="text-foreground tabular-nums">
										{r.briefing.calls} calls, {r.briefing.escalated} escalated, {r.briefing
											.sessions_started_work_first} session(s) started work without one
									</dd>
								</div>
								{#if r.by_engine.length}
									<div class="flex flex-wrap gap-x-2">
										<dt>By engine</dt>
										<dd class="text-foreground">
											{r.by_engine
												.map(
													(e) =>
														`${e.engine}: ${e.searches}${e.explicit ? ` (${e.explicit} asked for)` : ''}`
												)
												.join(' · ')}
											<span class="text-muted-foreground">
												— rows that asked for an engine are self-selected, so this is an
												observation, not an A/B
											</span>
										</dd>
									</div>
								{/if}
								<div class="flex flex-wrap gap-x-2">
									<dt>Oldest row</dt>
									<dd class="text-foreground">{fmt(r.oldest)}</dd>
								</div>
							</dl>
						</div>
					{/if}
				{:catch e}
					<p class="text-sm text-destructive">
						{(e as Error)?.message ?? 'Failed to load the summary'}
					</p>
				{/await}
			{/if}
		</Card.Content>
	</Card.Root>

	<!-- The queue, not the count: a zero-result row is only actionable once you
	     can see which options it was called with. -->
	<Card.Root>
		<Card.Header>
			<Card.Title class="flex items-center gap-2 text-base">
				<SearchX class="size-4" />
				Search failures
			</Card.Title>
			<Card.Description>
				Empty results, or ones covering under half the query, from the last 30 days — with the
				options each was called with, so the cause is read instead of guessed.
			</Card.Description>
		</Card.Header>
		<Card.Content>
			{#if failures}
				{#await failures}
					<div class="space-y-2">
						{#each [0, 1, 2] as i (i)}<Skeleton class="h-12 w-full" />{/each}
					</div>
				{:then rows}
					{#if rows.length === 0}
						<p class="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
							Nothing came back empty or thin in this window.
						</p>
					{:else}
						<ScrollArea class="h-80 rounded-lg border">
							<ul class="divide-y">
								{#each rows as row (row.id)}
									<li class="space-y-1 p-3">
										<div class="flex flex-wrap items-center gap-2 text-xs">
											<span class="text-muted-foreground tabular-nums">{fmt(row.createdAt)}</span>
											<Badge variant="secondary" class="font-mono text-[10px]">search</Badge>
											{#if row.engine}
												<Badge variant="outline" class="font-mono text-[10px]">{row.engine}</Badge>
											{/if}
											<span class="text-muted-foreground tabular-nums">
												{row.hitCount === 0
													? 'empty'
													: `${row.bestMatchedTerms ?? 0}/${row.terms ?? 0} terms`} · {row.hitCount ??
													0}
												hits
												{#if row.options?.min_terms !== undefined}
													· min_terms {row.options.min_terms}{/if}
												{#if row.options?.limit !== undefined}
													· limit {row.options.limit}{/if}
												{#if row.options?.namespace}
													· ns {row.options.namespace}{/if}
												{#if row.options?.type}
													· type {row.options.type}{/if}
												{#if row.options?.engine}
													· asked for {row.options.engine}{/if}
												{#if !row.options}
													· options not recorded (older row){/if}
											</span>
										</div>
										{#if row.queryText}
											<p class="font-mono text-[11px] wrap-break-word">{row.queryText}</p>
										{:else if row.queryText === ''}
											<!-- Empty string, not null: a "show me recent items" call that older
											     rows recorded with one fake term. Saying "counters-only" here would
											     be false — this account does store query text. -->
											<p class="text-[11px] text-muted-foreground">
												empty query — a recent-items call, not a miss
											</p>
										{:else}
											<p class="text-[11px] text-muted-foreground">
												query text not stored — this account is on the counters-only tier
											</p>
										{/if}
									</li>
								{/each}
							</ul>
						</ScrollArea>
					{/if}
				{:catch e}
					<p class="text-sm text-destructive">
						{(e as Error)?.message ?? 'Failed to load the failure queue'}
					</p>
				{/await}
			{/if}
		</Card.Content>
	</Card.Root>

	<!-- Erase. Separate from "off" on purpose: stopping collection is not the
	     same as removing what was already collected. -->
	<Card.Root>
		<Card.Header>
			<Card.Title class="flex items-center gap-2 text-base">
				<Trash2 class="size-4" /> Erase telemetry
			</Card.Title>
			<Card.Description>
				Deleting is also how you enforce the retention promise early — no waiting for the configured
				window.
			</Card.Description>
		</Card.Header>
		<Card.Content class="flex flex-wrap items-center justify-between gap-3">
			<p class="max-w-prose text-xs text-muted-foreground">
				Removes every telemetry row for this account. It does not change the setting, so if
				telemetry is still on it will simply start recording again.
			</p>
			<!-- The form wraps the trigger; confirming in the dialog below submits it. -->
			<form {...eraseTelemetry} class="contents">
				<Button variant="outline" disabled={erasing} onclick={() => (confirmErase = true)}>
					{erasing ? 'Erasing…' : 'Erase all telemetry'}
				</Button>
			</form>
		</Card.Content>
	</Card.Root>
</div>

<ConfirmDeleteDialog
	open={confirmErase}
	onClose={() => (confirmErase = false)}
	title="Erase all telemetry?"
	description="This permanently removes every telemetry row stored for your account. The telemetry setting itself is left as it is. This cannot be undone."
	confirmLabel="Erase all telemetry"
	onConfirm={runErase}
/>

<ConfirmDeleteDialog
	open={pendingDelete !== null}
	onClose={() => (pendingDelete = null)}
	title={pendingDelete?.title ?? 'Delete this item?'}
	description={pendingDelete?.description ?? ''}
	onConfirm={pendingDelete?.run}
/>
