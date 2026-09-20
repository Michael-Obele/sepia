<script lang="ts">
	import { Activity, ShieldCheck, TriangleAlert } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import { ScrollArea } from '$lib/components/ui/scroll-area/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import ConfirmDeleteDialog from '$lib/components/confirm-delete-dialog.svelte';
	import {
		eraseTelemetry,
		getTelemetry,
		getTelemetryEvents,
		getTelemetryReport,
		updateTelemetryTier
	} from '$lib/remote/index.js';
	import type { TelemetryTier } from '@sepia/shared';

	let { data } = $props();

	// Every page reads auth from the root layout; remote calls made while
	// anonymous would 401 during SSR, so they are all gated on this.
	const isAuthed = () => Boolean(data.user);

	const settings = $derived(isAuthed() ? getTelemetry() : null);
	const report = $derived(isAuthed() ? getTelemetryReport() : null);
	const events = $derived(isAuthed() ? getTelemetryEvents(50) : null);

	let saving = $state(false);
	let erasing = $state(false);
	let confirmErase = $state(false);

	function pct(n: number, of: number): string {
		if (!of) return '—';
		return `${Math.round((n / of) * 100)}%`;
	}

	async function setTier(tier: TelemetryTier) {
		saving = true;
		try {
			await updateTelemetryTier({ tier });
			if (tier === 'off') {
				toast.success('Telemetry off', {
					description:
						'Nothing further will be recorded. Rows already stored are kept until you erase them.'
				});
			} else {
				toast.success(
					tier === 'transcripts'
						? 'Telemetry on — counters and query text'
						: 'Telemetry on — counters only',
					{ description: 'Recording into your own database. Nothing leaves your infrastructure.' }
				);
			}
			settings?.refresh();
			report?.refresh();
			events?.refresh();
		} catch (e) {
			toast.error((e as Error)?.message ?? 'Could not change the telemetry setting');
		} finally {
			saving = false;
		}
	}

	async function runErase() {
		confirmErase = false;
		erasing = true;
		try {
			const deleted = await eraseTelemetry();
			toast.success(`Erased ${deleted} telemetry ${deleted === 1 ? 'row' : 'rows'}`, {
				description:
					'The setting is unchanged — turn telemetry off as well if you want it to stop collecting.'
			});
			report?.refresh();
			events?.refresh();
		} catch (e) {
			toast.error((e as Error)?.message ?? 'Could not erase telemetry');
		} finally {
			erasing = false;
		}
	}

	const fmt = (v: string | null) => (v ? new Date(v).toLocaleString() : '—');
</script>

<div class="space-y-6">
	<header class="space-y-1">
		<h1 class="text-2xl font-semibold tracking-tight">Telemetry</h1>
		<p class="text-sm text-muted-foreground">
			Optional, off by default, and stored only in your own database. We don't recommend turning it
			on.
		</p>
	</header>

	<!-- The framing comes first. A privacy control should read like a contract,
	     not a feature, so the honest recommendation is stated before the switch. -->
	<Card.Root>
		<Card.Header>
			<Card.Title class="flex items-center gap-2 text-base">
				<ShieldCheck class="size-4" />
				The short version
			</Card.Title>
		</Card.Header>
		<Card.Content class="space-y-3 text-sm">
			<p>
				<strong class="font-medium">We run this on our own account only.</strong> It exists so that search
				failures are visible instead of guessed at — without it, the only feedback loop is somebody noticing
				that something felt wrong.
			</p>
			<p class="text-muted-foreground">
				Enabling it on your account helps us improve Sepia, and that is the only reason to do it. It
				is off for every account, it changes nothing about what your AI sees, and everything it
				records stays in your Postgres — there is no third-party analytics service anywhere in this
				project, and no data is sent to us.
			</p>
		</Card.Content>
	</Card.Root>

	<!-- Always visible, on or off: informed consent cannot be conditional on
	     having already consented. -->
	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">What is recorded</Card.Title>
			<Card.Description>
				Two tiers. Lower tiers store strictly less; nothing in a lower tier is optional.
			</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-4 text-sm">
			<div class="rounded-lg border p-3">
				<div class="flex items-center gap-2">
					<Badge variant="outline" class="font-mono text-[10px] tracking-wider uppercase"
						>signals</Badge
					>
					<span class="text-muted-foreground">Counters only</span>
				</div>
				<ul class="mt-2 space-y-1 text-xs text-muted-foreground">
					<li>Which tool ran, and which field a setting had.</li>
					<li>
						For a search: how many terms matched, how many results came back, latency, payload size.
					</li>
					<li>
						A salted, <strong class="font-medium text-foreground">day-rotating</strong> fingerprint of
						the query — equivalent queries group together, but the query text cannot be recovered, and
						the daily salt makes profiling across days impossible by construction.
					</li>
				</ul>
			</div>
			<div class="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
				<div class="flex items-center gap-2">
					<Badge variant="outline" class="font-mono text-[10px] tracking-wider uppercase"
						>transcripts</Badge
					>
					<span class="text-muted-foreground">Everything above, plus</span>
				</div>
				<ul class="mt-2 space-y-1 text-xs text-muted-foreground">
					<li>
						The <strong class="font-medium text-foreground">raw query text</strong> and the ids of what
						it returned, kept for 30 days and then cleared.
					</li>
					<li>
						This is the tier that turns a real failure into something reproducible, which is why it
						exists.
					</li>
					<li>Query text can contain whatever you asked your AI — treat it accordingly.</li>
				</ul>
			</div>
			<Separator />
			<div class="flex items-start gap-2">
				<TriangleAlert class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
				<p class="text-xs text-muted-foreground">
					<strong class="font-medium text-foreground">Never recorded, at either tier:</strong>
					memory content, entity names, your conversations with an AI, or credentials. This is enforced
					where the row is written, not by policy — a lower tier writes a
					<code class="font-mono text-[11px]">null</code> into those columns.
				</p>
			</div>
		</Card.Content>
	</Card.Root>

	<!-- The control itself -->
	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Collecting</Card.Title>
		</Card.Header>
		<Card.Content class="space-y-4">
			{#if settings}
				{#await settings}
					<Skeleton class="h-16 w-full" />
				{:then s}
					<label
						for="telemetry-enabled"
						class="flex cursor-pointer items-center justify-between gap-3 rounded-lg border p-3 transition-colors has-data-[state=checked]:bg-muted/40"
					>
						<span class="space-y-0.5">
							<span class="block text-sm font-medium">
								{s.tier === 'off' ? 'Telemetry is off' : 'Telemetry is on'}
							</span>
							<span class="block text-xs text-muted-foreground">
								{s.tier === 'off'
									? 'Nothing is being recorded for this account.'
									: s.enabledAt
										? `Recording since ${fmt(s.enabledAt)}.`
										: 'Recording.'}
							</span>
						</span>
						<Switch
							id="telemetry-enabled"
							checked={s.tier !== 'off'}
							disabled={saving}
							onCheckedChange={(checked) => setTier(checked ? 'signals' : 'off')}
						/>
					</label>

					{#if s.tier !== 'off'}
						<div class="space-y-2">
							<p class="text-xs text-muted-foreground">
								How much to record. Turning this on starts at the lower tier on purpose — widen it
								only if you want failures to be reproducible.
							</p>
							<div class="flex flex-wrap gap-2">
								<Button
									size="sm"
									variant={s.tier === 'signals' ? 'default' : 'ghost'}
									disabled={saving}
									onclick={() => setTier('signals')}>Counters only</Button
								>
								<Button
									size="sm"
									variant={s.tier === 'transcripts' ? 'default' : 'outline'}
									disabled={saving}
									onclick={() => setTier('transcripts')}>Counters + query text</Button
								>
							</div>
							<p class="text-xs text-muted-foreground">
								Raw query text and returned ids are cleared after {s.ttlDays} days, when this page is
								next opened — this project has no scheduler, so retention is enforced on read rather than
								pretended.
							</p>
						</div>
					{/if}
				{:catch e}
					<p class="text-sm text-destructive">
						{(e as Error)?.message ?? 'Failed to load telemetry settings'}
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
							Nothing recorded. Turn telemetry on above if you want to see what this would show.
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
									<dt>Follow-up search within 120s</dt>
									<dd class="text-foreground tabular-nums">
										{r.reformulated} ({pct(r.reformulated, r.correlated_searches)} of attributable searches)
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
											{r.by_engine.map((e) => `${e.engine}: ${e.searches}`).join(' · ')}
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

	<!-- Transparency viewer: the owner sees the rows themselves. -->
	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Stored rows</Card.Title>
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

	<!-- Erase. Separate from "off" on purpose: stopping collection is not the
	     same as removing what was already collected. -->
	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Erase</Card.Title>
			<Card.Description>
				Deleting is also how you enforce the retention promise early — no waiting for the 30-day
				window.
			</Card.Description>
		</Card.Header>
		<Card.Content class="flex flex-wrap items-center justify-between gap-3">
			<p class="max-w-prose text-xs text-muted-foreground">
				Removes every telemetry row for this account. It does not change the setting above, so if
				telemetry is still on it will simply start recording again.
			</p>
			<Button variant="outline" disabled={erasing} onclick={() => (confirmErase = true)}>
				{erasing ? 'Erasing…' : 'Erase all telemetry'}
			</Button>
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
