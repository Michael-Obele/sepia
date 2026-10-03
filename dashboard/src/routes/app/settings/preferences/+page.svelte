<script lang="ts">
	import { Plus, Trash2, Database, ShieldCheck, TriangleAlert, Activity } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import { toast } from 'svelte-sonner';
	import {
		getPreferencesPage,
		addNamespace,
		removeNamespace,
		updateTelemetryTier,
		updateTelemetryTtl
	} from '$lib/remote/index.js';
	import { fresh } from '$lib/fresh.js';
	import type { TelemetryTier } from '@sepia/shared';
	import ConfirmDeleteDialog from '$lib/components/confirm-delete-dialog.svelte';

	let { data } = $props();
	const isAuthed = () => Boolean(data.user);

	/** This page's view model: the namespace list plus the telemetry setting. */
	type View = Awaited<ReturnType<typeof getPreferencesPage>>;

	// AWAITED DURING SSR — see the note in `entities/+page.svelte`. ONE Neon HTTP
	// round trip for both cards, serialised into the payload, so the browser makes
	// no initial data request.
	const initialPage: View = isAuthed()
		? await getPreferencesPage()
		: { namespaces: [], settings: { tier: 'off', ttlDays: 30, enabledAt: null } };

	let view = $state<View>(initialPage);

	// Render `view` DIRECTLY — see the note in `app/+page.svelte` for why wrapping
	// these in a promise for `{#await}` leaves the page stuck on its skeleton.

	/** Re-read both cards — namespace edits and telemetry edits both land here. */
	async function reload() {
		view = await fresh(getPreferencesPage());
	}

	let newName = $state('');
	let newDesc = $state('');
	let saving = $state(false);

	// Delete confirmation — the dialog gates the actual delete.
	let pendingDelete = $state<{
		title: string;
		description: string;
		run: () => void | Promise<void>;
	} | null>(null);

	/** Retention choices offered here — the schema allows any 1–365. */
	const TTL_PRESETS = [7, 30, 90, 180, 365];

	async function delNs(id: string, name: string) {
		if (name === 'personal') {
			toast.error('The default "personal" namespace cannot be deleted');
			return;
		}
		try {
			await removeNamespace(id);
			toast.success(`Namespace "${name}" deleted`);
			void reload();
		} catch (e) {
			toast.error((e as Error)?.message ?? 'Failed to delete namespace');
		}
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
			void reload();
		} catch (e) {
			toast.error((e as Error)?.message ?? 'Could not change the telemetry setting');
		} finally {
			saving = false;
		}
	}

	const fmt = (v: string | null) => (v ? new Date(v).toLocaleString() : '—');
</script>

<div class="space-y-6">
	<Card.Root>
		<Card.Header>
			<Card.Title class="flex items-center gap-2 text-base">
				<Database class="size-4" /> Namespaces
			</Card.Title>
			<Card.Description>
				Isolated containers for memory. Deleting a namespace removes everything inside it.
			</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-4">
			<form
				{...addNamespace.enhance(async (f) => {
					try {
						if (await f.submit()) {
							toast.success(`Namespace "${newName.trim()}" created`);
							// Clearing the bound state empties the inputs — the form itself
							// is not reset by enhance.
							newName = '';
							newDesc = '';
						} else {
							toast.error(f.fields.allIssues()?.[0]?.message ?? 'Check the form fields');
						}
					} catch (e) {
						toast.error((e as Error)?.message ?? 'Failed to create namespace');
					}
				})}
				class="flex flex-col gap-2 sm:flex-row"
			>
				<Input
					bind:value={newName}
					name="name"
					placeholder="New namespace name"
					class="sm:max-w-56"
				/>
				<Input
					bind:value={newDesc}
					name="description"
					placeholder="Description (optional)"
					class="flex-1"
				/>
				<Button type="submit" disabled={addNamespace.pending > 0} class="gap-1">
					<Plus class="size-4" /> Create
				</Button>
			</form>
			{#if view.namespaces.length}
				{@const ns = view.namespaces}
				<div class="space-y-2">
					{#each ns as n (n.id)}
						<div class="flex items-center justify-between gap-3 rounded-md border p-3">
							<div class="min-w-0">
								<div class="flex items-center gap-2">
									<p class="font-medium">{n.name}</p>
									{#if n.name === 'personal'}
										<Badge variant="secondary">default</Badge>
									{/if}
								</div>
								{#if n.description}
									<p class="truncate text-xs text-muted-foreground">{n.description}</p>
								{/if}
								<p class="text-xs text-muted-foreground">
									{n.entity_count} entities · {n.memory_count} memories · {n.relation_count} relations
								</p>
							</div>
							<Button
								variant="ghost"
								size="icon"
								onclick={() =>
									(pendingDelete = {
										title: `Delete namespace "${n.name}"?`,
										description:
											'This permanently removes all its entities, relations, and memories. This cannot be undone.',
										run: () => delNs(String(n.id), n.name)
									})}
								disabled={n.name === 'personal'}
								aria-label={`Delete namespace ${n.name}`}
							>
								<Trash2 class="size-4 text-destructive" />
							</Button>
						</div>
					{/each}
				</div>
			{/if}
		</Card.Content>
	</Card.Root>

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
						For a search: how many terms matched, how many results came back, latency, payload size,
						and the options it was called with — page size, precision dial, scope filters. That is
						what lets an empty result be told apart from one the caller deliberately narrowed.
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
						it returned, kept only for your retention window (1–365 days, default 30, set below) and then
						cleared.
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
			{#if view.settings}
				{@const s = view.settings}
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
								variant={s.tier === 'signals' ? 'default' : 'outline'}
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
					</div>
				{/if}

				<!-- Retention is shown whether telemetry is on or off: the current
					     window is part of what the owner is agreeing to, so it is never
					     hidden behind a tier. The presets are the submit buttons of one
					     remote form, so the choice survives without JavaScript. -->
				<form
					{...updateTelemetryTtl.enhance(async (f) => {
						try {
							if (await f.submit()) {
								toast.success(`Raw query text kept for ${f.result?.ttlDays} days`, {
									description:
										'Counters are untouched — only the expiry of raw query text and returned ids changed.'
								});
							} else {
								toast.error('Retention must be between 1 and 365 days');
							}
						} catch (e) {
							toast.error((e as Error)?.message ?? 'Could not change the retention window');
						}
					})}
					class="space-y-2"
				>
					<div class="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
						<span class="space-y-0.5">
							<span class="block text-sm font-medium">
								Raw query text kept for {s.ttlDays}
								{s.ttlDays === 1 ? 'day' : 'days'}
							</span>
							<span class="block text-xs text-muted-foreground">
								{s.tier === 'off'
									? 'Applies to query text once telemetry is on at the query-text tier.'
									: 'Counters are kept until you erase them — only raw query text and returned ids expire.'}
							</span>
						</span>
						<div class="flex flex-wrap gap-2">
							{#each TTL_PRESETS as days (days)}
								<Button
									size="sm"
									variant={s.ttlDays === days ? 'default' : 'outline'}
									disabled={updateTelemetryTtl.pending > 0}
									{...updateTelemetryTtl.fields.ttlDays.as('submit', days)}
								>
									{days === 365 ? '1 year' : `${days} days`}
								</Button>
							{/each}
						</div>
					</div>
					<p class="text-xs text-muted-foreground">
						Expired payloads are cleared when this page is next read — this project has no
						scheduler, so retention is enforced on read rather than pretended.
					</p>
				</form>
			{/if}
			<p class="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
				<Activity class="size-3" /> Anything already recorded lives in
				<a href="/app/settings/data" class="underline underline-offset-2">Data &amp; privacy</a>.
			</p>
		</Card.Content>
	</Card.Root>
</div>

<ConfirmDeleteDialog
	open={pendingDelete !== null}
	onClose={() => (pendingDelete = null)}
	title={pendingDelete?.title ?? 'Delete this item?'}
	description={pendingDelete?.description ?? ''}
	onConfirm={pendingDelete?.run}
/>
