<script lang="ts">
	import {
		KeyRound,
		Copy,
		Check,
		Trash2,
		ShieldCheck,
		Sparkles,
		CreditCard,
		Globe,
		Monitor,
		Info,
		Terminal,
		Unlink,
		PlugZap,
		Clock3
	} from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Progress } from '$lib/components/ui/progress/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { toast } from 'svelte-sonner';
	import {
		getMe,
		listApiKeys,
		createApiKey,
		deleteApiKey,
		listConnections,
		disconnectConnection
	} from '$lib/remote/index.js';
	import { auth, isAuthed, logout } from '$lib/auth.svelte';
	import { goto } from '$app/navigation';

	const me = $derived(isAuthed() ? getMe(auth.token) : null);

	/**
	 * Usage meter helpers — the "what you've burned" view.
	 * Semantic colors: <80% primary, 80-99% amber (nudge), ≥100% red (at limit).
	 * The Progress indicator is bg-primary by default; the arbitrary variant
	 * overrides it per state (Tailwind v4).
	 */
	function pct(used: number, limit: number): number {
		if (limit <= 0) return 0;
		return Math.min(100, Math.round((used / limit) * 100));
	}

	function meterClass(used: number, limit: number): string {
		const p = pct(used, limit);
		if (p >= 100) return '[&_[data-slot=progress-indicator]]:bg-destructive';
		if (p >= 80) return '[&_[data-slot=progress-indicator]]:bg-amber-500';
		return '';
	}

	/** Payment portal is coming — until then, the upgrade button toasts. */
	function upgrade() {
		toast.info('Payment portal coming soon', {
			description: "We're wiring up billing — you'll be able to upgrade right here shortly."
		});
	}

	let copied = $state('');
	let creatingKey = $state(false);
	let newKey = $state<string | null>(null);
	let keys = $state<
		Array<{ id: string; name: string; createdAt: string; lastRequest: string | null }>
	>([]);
	let keysLoaded = $state(false);

	// Web AI connections (OAuth) — the counted quota
	let connections = $state<
		Array<{
			id: string;
			clientId: string;
			name: string;
			redirectUris: string[];
			createdAt: string;
			lastUsedAt: string | null;
			active: boolean;
		}>
	>([]);
	let connectionsLoaded = $state(false);
	let disconnectingId = $state<string | null>(null);
	let pendingDisconnect: { clientId: string; name: string } | null = $state(null);

	function hostFromUris(uris: string[]): string {
		for (const u of uris) {
			try {
				return new URL(u).hostname;
			} catch {
				// ignore
			}
		}
		return 'unknown';
	}

	function formatDate(iso: string | null): string {
		if (!iso) return '—';
		try {
			return new Date(iso).toLocaleDateString(undefined, {
				year: 'numeric',
				month: 'short',
				day: 'numeric'
			});
		} catch {
			return iso;
		}
	}

	async function loadKeys() {
		if (!isAuthed()) return;
		keysLoaded = false;
		try {
			keys = await listApiKeys(auth.token);
		} catch (e) {
			toast.error((e as Error)?.message ?? 'Failed to load API keys');
		} finally {
			keysLoaded = true;
		}
	}

	async function loadConnections() {
		if (!isAuthed()) return;
		connectionsLoaded = false;
		try {
			connections = await listConnections(auth.token);
		} catch (e) {
			toast.error((e as Error)?.message ?? 'Failed to load Web AI connections');
		} finally {
			connectionsLoaded = true;
		}
	}

	async function confirmDisconnect() {
		if (!pendingDisconnect) return;
		const { clientId, name } = pendingDisconnect;
		pendingDisconnect = null;
		disconnectingId = clientId;
		try {
			await disconnectConnection([auth.token, clientId]);
			toast.success(`Disconnected ${name}`);
			await Promise.all([loadConnections(), loadKeys()]);
			// Refresh usage (me) by re-triggering the derived query — force reload via page reload of data
			// The getMe query is cached; we bust it by reloading connections which triggers a re-render
			// and the parent layout will refetch on next navigation. For immediate feedback, reload the page data.
			window.location.reload();
		} catch (e) {
			toast.error((e as Error)?.message ?? 'Failed to disconnect');
		} finally {
			disconnectingId = null;
		}
	}

	async function createKey() {
		creatingKey = true;
		newKey = null;
		try {
			const { key } = await createApiKey(auth.token);
			newKey = key;
			toast.success('API key created — copy it now, it is shown only once');
			await loadKeys();
		} catch (e) {
			toast.error((e as Error)?.message ?? 'Failed to create API key');
		} finally {
			creatingKey = false;
		}
	}

	async function deleteKey(id: string) {
		if (!confirm('Delete this API key? Anything using it will stop working.')) return;
		try {
			await deleteApiKey([auth.token, id]);
			toast.success('API key deleted');
			await loadKeys();
		} catch (e) {
			toast.error((e as Error)?.message ?? 'Failed to delete API key');
		}
	}

	async function copy(text: string, key: string) {
		await navigator.clipboard.writeText(text);
		copied = key;
		setTimeout(() => (copied = ''), 1500);
	}

	function handleLogout() {
		logout();
		goto('/');
	}

	$effect(() => {
		if (isAuthed() && !keysLoaded) loadKeys();
	});
	$effect(() => {
		if (isAuthed() && !connectionsLoaded) loadConnections();
	});
</script>

<svelte:head>
	<title>Account — Sepia</title>
</svelte:head>

<div class="mx-auto space-y-6">
	<div class="flex items-center justify-between">
		<div>
			<h1 class="text-2xl font-semibold tracking-tight">Account</h1>
			<p class="text-sm text-muted-foreground">Your plan, usage, and API keys.</p>
		</div>
		<Button variant="outline" onclick={handleLogout}>Sign out</Button>
	</div>

	{#if me?.current}
		{@const account = me.current}
		<Card>
			<CardHeader>
				<CardTitle class="flex items-center gap-2">
					{account.user.name}
					{#if account.user.plan === 'pro'}
						<Badge class="gap-1 bg-primary text-primary-foreground">
							<Sparkles class="size-3" /> Pro
						</Badge>
					{:else}
						<Badge variant="secondary">Free</Badge>
					{/if}
				</CardTitle>
				<CardDescription>{account.user.email}</CardDescription>
			</CardHeader>
			<CardContent class="space-y-5">
				<!-- What you've burned from your plan -->
				<div class="space-y-4">
					<div class="space-y-1.5">
						<div class="flex items-baseline justify-between text-sm">
							<span class="font-medium">Namespaces</span>
							<span class="text-muted-foreground">
								{account.usage.namespaces} / {account.usage.limits.maxNamespaces}
								<span class="ml-1 text-xs"
									>({pct(account.usage.namespaces, account.usage.limits.maxNamespaces)}%)</span
								>
							</span>
						</div>
						<Progress
							value={pct(account.usage.namespaces, account.usage.limits.maxNamespaces)}
							class={meterClass(account.usage.namespaces, account.usage.limits.maxNamespaces)}
						/>
					</div>

					<div class="space-y-1.5">
						<div class="flex items-baseline justify-between text-sm">
							<span class="font-medium">Memories</span>
							<span class="text-muted-foreground">
								{account.usage.memories.toLocaleString()} / {account.usage.limits.maxMemories.toLocaleString()}
								<span class="ml-1 text-xs"
									>({pct(account.usage.memories, account.usage.limits.maxMemories)}%)</span
								>
							</span>
						</div>
						<Progress
							value={pct(account.usage.memories, account.usage.limits.maxMemories)}
							class={meterClass(account.usage.memories, account.usage.limits.maxMemories)}
						/>
					</div>

					<!-- AI connections — two planes, one counted, one never -->
					<div class="space-y-3">
						<p
							class="flex items-center gap-2 font-mono text-[11px] tracking-wider text-muted-foreground uppercase"
						>
							<Separator class="flex-1" />
							<span class="shrink-0">AI connections — what counts?</span>
							<Separator class="flex-1" />
						</p>

						<!-- Web AI connections — COUNTED (OAuth) -->
						<Tooltip.Provider>
							<div class="space-y-2.5 rounded-xl border border-violet-500/20 bg-violet-500/5 p-3.5">
								<div class="flex flex-wrap items-center justify-between gap-2">
									<span class="inline-flex flex-wrap items-center gap-1.5 text-sm font-medium">
										<span
											class="inline-flex size-6 items-center justify-center rounded-md bg-violet-500/15 text-violet-600 dark:text-violet-400"
										>
											<Globe class="size-3.5" />
										</span>
										Web AI connections
										<Badge
											variant="outline"
											class="border-violet-500/30 bg-violet-500/10 font-mono text-[10px] tracking-wider text-violet-700 uppercase dark:text-violet-300"
											>Counts toward limit</Badge
										>
										<Tooltip.Root>
											<Tooltip.Trigger
												class="inline-flex size-5 items-center justify-center rounded-full border border-violet-500/20 bg-background text-muted-foreground hover:bg-muted"
												aria-label="What counts as a Web AI connection"
											>
												<Info class="size-3" />
											</Tooltip.Trigger>
											<Tooltip.Content side="top" class="max-w-72 text-xs leading-relaxed">
												Web AIs connect via OAuth 2.1 — ChatGPT, Claude web, Grok, Gemini,
												Perplexity, Le Chat. Each provider you authorize counts as 1. AI editors use
												a bearer token and never count.
											</Tooltip.Content>
										</Tooltip.Root>
									</span>
									{#if account.usage.limits.maxAiConnections === null}
										<span
											class="shrink-0 rounded-full bg-violet-500/10 px-2.5 py-1 text-sm font-medium text-violet-700 dark:text-violet-300"
										>
											{account.usage.ai_connections}
											<span class="text-xs font-normal opacity-70">/ unlimited</span>
										</span>
									{:else}
										<span class="shrink-0 text-sm text-muted-foreground">
											{account.usage.ai_connections} / {account.usage.limits.maxAiConnections}
											<span class="ml-1 text-xs"
												>({pct(
													account.usage.ai_connections,
													account.usage.limits.maxAiConnections
												)}%)</span
											>
										</span>
									{/if}
								</div>
								<p class="text-xs leading-relaxed text-muted-foreground">
									<span class="font-medium text-foreground">OAuth 2.1</span> — ChatGPT, Claude web,
									Grok, Gemini, Perplexity, Le Chat. Each provider = 1 connection. Free: 1 · Pro:
									unlimited.
									<a
										href="/pricing"
										class="underline decoration-dotted underline-offset-2 hover:text-foreground"
										>See pricing</a
									>
								</p>
								{#if account.usage.limits.maxAiConnections !== null}
									<Progress
										value={pct(account.usage.ai_connections, account.usage.limits.maxAiConnections)}
										class={meterClass(
											account.usage.ai_connections,
											account.usage.limits.maxAiConnections
										)}
									/>
								{:else}
									<div class="h-1.5 rounded-full bg-muted"></div>
								{/if}

								<!-- Manage — list + disconnect -->
								<div class="pt-1">
									{#if !connectionsLoaded}
										<Skeleton class="h-16 w-full" />
									{:else if connections.length === 0}
										<p class="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
											No Web AI connections yet. Connect one from
											<a
												href="/app/connect"
												class="underline underline-offset-2 hover:text-foreground">Connect</a
											>.
										</p>
									{:else}
										<ul class="space-y-2">
											{#each connections as c (c.clientId)}
												<li
													class="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-3"
												>
													<div class="min-w-0 flex-1">
														<div class="flex flex-wrap items-center gap-2">
															<span
																class="inline-flex size-6 items-center justify-center rounded-md bg-violet-500/15 text-violet-600 dark:text-violet-400"
															>
																<Globe class="size-3.5" />
															</span>
															<span class="text-sm font-medium">{c.name}</span>
															<Badge variant="secondary" class="font-mono text-[11px] font-normal"
																>{hostFromUris(c.redirectUris)}</Badge
															>
															{#if c.active}
																<Badge
																	class="gap-1 bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300"
																>
																	<span class="size-1.5 rounded-full bg-emerald-500"></span> Active
																</Badge>
															{:else}
																<Badge variant="outline" class="gap-1 text-muted-foreground">
																	<Clock3 class="size-3" /> Inactive
																</Badge>
															{/if}
														</div>
														<p
															class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground"
														>
															<span class="inline-flex items-center gap-1"
																><Clock3 class="size-3" /> Connected {formatDate(c.createdAt)}</span
															>
															{#if c.lastUsedAt}
																<span>· Last used {formatDate(c.lastUsedAt)}</span>
															{/if}
															<Tooltip.Provider>
																<Tooltip.Root>
																	<Tooltip.Trigger
																		class="underline decoration-dotted underline-offset-2 hover:text-foreground"
																		>{c.clientId.slice(0, 8)}…</Tooltip.Trigger
																	>
																	<Tooltip.Content class="max-w-80 font-mono text-xs break-all"
																		>{c.clientId}</Tooltip.Content
																	>
																</Tooltip.Root>
															</Tooltip.Provider>
														</p>
													</div>
													<Button
														size="sm"
														variant="outline"
														class="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
														disabled={disconnectingId === c.clientId}
														onclick={() =>
															(pendingDisconnect = { clientId: c.clientId, name: c.name })}
													>
														<Unlink class="size-3.5" />
														{disconnectingId === c.clientId ? 'Disconnecting…' : 'Disconnect'}
													</Button>
												</li>
											{/each}
										</ul>
										{#if connections.length > 1}
											<p class="mt-2 text-xs text-muted-foreground">
												<PlugZap class="mr-1 inline size-3" />
												You have {connections.length} Web AI connections. Each counts toward your limit
												({account.usage.ai_connections} shown above). Disconnect any you no longer use
												to free a slot.
											</p>
										{/if}
									{/if}
								</div>
							</div>
						</Tooltip.Provider>

						<!-- Explicit separator — two different systems -->
						<div class="flex items-center gap-3 py-1">
							<Separator class="flex-1" />
							<span
								class="inline-flex items-center gap-1.5 rounded-full border bg-muted/50 px-2.5 py-1 font-mono text-[10px] tracking-wider text-muted-foreground uppercase"
							>
								<span class="size-1.5 rounded-full bg-emerald-500"></span>
								Separate system — not counted below
							</span>
							<Separator class="flex-1" />
						</div>

						<!-- AI editors — NEVER COUNTED (bearer token) -->
						<div
							class="flex items-start gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3.5"
						>
							<div
								class="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
							>
								<Monitor class="size-3.5" />
							</div>
							<div class="min-w-0 flex-1">
								<div class="flex flex-wrap items-center gap-2">
									<span class="text-sm font-medium">AI editors</span>
									<Badge
										class="gap-1 bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300"
									>
										<Check class="size-3" /> Unlimited — never counted
									</Badge>
								</div>
								<p class="mt-1 text-xs leading-relaxed text-muted-foreground">
									Claude Code, Cursor, Copilot, Codex, Zed, OpenCode —
									<span class="font-medium text-foreground">bearer token (MCP)</span>. Not metered,
									not limited, not billed. Add as many as you want on any plan.
								</p>
								<p
									class="mt-2 inline-flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground/80"
								>
									<Terminal class="size-3" /> Managed below via
									<span class="font-medium text-foreground">API keys</span>
									<span class="hidden sm:inline"
										>— completely separate from Web AI connections.</span
									>
									<span class="sm:hidden">— separate from Web AIs.</span>
								</p>
							</div>
						</div>
					</div>
				</div>

				<p class="text-xs text-muted-foreground">
					Reads, search, and export are never blocked. Only new writes pause at the limits.
				</p>

				<!-- Upgrade CTA — payment portal is coming, so the button toasts -->
				<div
					class="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 p-4"
				>
					<div>
						<p class="text-sm font-medium">
							{#if account.user.plan === 'free'}
								Need more room?
							{:else}
								Enjoying Pro?
							{/if}
						</p>
						<p class="text-xs text-muted-foreground">
							{#if account.user.plan === 'free'}
								100 namespaces · 1,000,000 memories · unlimited Web AI connections — $50/yr.
								<span class="text-muted-foreground/80">AI editors always unlimited.</span>
							{:else}
								Manage your subscription, billing, and invoices here.
							{/if}
						</p>
					</div>
					<Button onclick={upgrade} class="gap-1.5">
						<CreditCard class="size-4" />
						{#if account.user.plan === 'free'}
							Upgrade to Pro
						{:else}
							Manage plan
						{/if}
					</Button>
				</div>
			</CardContent>
		</Card>

		<!-- Disconnect confirmation -->
		<AlertDialog.Root
			open={!!pendingDisconnect}
			onOpenChange={(o) => {
				if (!o) pendingDisconnect = null;
			}}
		>
			<AlertDialog.Content>
				<AlertDialog.Header>
					<AlertDialog.Title>Disconnect {pendingDisconnect?.name ?? 'Web AI'}?</AlertDialog.Title>
					<AlertDialog.Description>
						This will revoke all tokens for this connection and free the slot. The Web AI will need
						to re-authorize to reconnect. This cannot be undone.
					</AlertDialog.Description>
				</AlertDialog.Header>
				<AlertDialog.Footer>
					<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
					<AlertDialog.Action
						class="text-destructive-foreground bg-destructive hover:bg-destructive/90"
						onclick={confirmDisconnect}
					>
						Disconnect
					</AlertDialog.Action>
				</AlertDialog.Footer>
			</AlertDialog.Content>
		</AlertDialog.Root>

		<Card>
			<CardHeader>
				<CardTitle class="flex items-center gap-2">
					<KeyRound class="size-4" /> API keys
					<Badge
						class="gap-1 bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300"
					>
						<Monitor class="size-3" /> Editors — unlimited
					</Badge>
				</CardTitle>
				<CardDescription>
					Bearer token for local editors (Claude Code, Cursor, Zed, Copilot). These are
					<span class="font-medium text-foreground">not Web AI connections</span> — they never count toward
					your Web AI limit.
				</CardDescription>
			</CardHeader>
			<CardContent class="space-y-4">
				{#if newKey}
					<div class="flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 p-3">
						<code class="flex-1 font-mono text-sm break-all">{newKey}</code>
						<Button size="sm" variant="outline" onclick={() => copy(newKey!, 'new-key')}>
							{#if copied === 'new-key'}
								<Check class="size-4" />
							{:else}
								<Copy class="size-4" />
							{/if}
						</Button>
					</div>
				{/if}
				<Button onclick={createKey} disabled={creatingKey}>
					{creatingKey ? 'Creating…' : 'Create API key'}
				</Button>
				{#if !keysLoaded}
					<Skeleton class="h-10 w-full" />
				{:else if keys.length === 0}
					<p class="text-sm text-muted-foreground">
						No API keys yet. Create one to connect an editor — it won’t affect your Web AI
						connection count.
					</p>
				{:else}
					<ul class="space-y-2">
						{#each keys as key (key.id)}
							<li class="flex items-center justify-between rounded-lg border p-3">
								<div>
									<p class="text-sm font-medium">{key.name}</p>
									<p class="text-xs text-muted-foreground">
										Created {new Date(key.createdAt).toLocaleDateString()}
										{#if key.lastRequest}
											· last used {new Date(key.lastRequest).toLocaleDateString()}{/if}
									</p>
								</div>
								<Button size="sm" variant="ghost" onclick={() => deleteKey(key.id)}>
									<Trash2 class="size-4" />
								</Button>
							</li>
						{/each}
					</ul>
				{/if}
			</CardContent>
		</Card>

		<Card>
			<CardHeader>
				<CardTitle class="flex items-center gap-2">
					<ShieldCheck class="size-4" /> Trust
				</CardTitle>
				<CardDescription
					>Your data is yours. Export everything, delete your account, cancel any time.</CardDescription
				>
			</CardHeader>
			<CardContent>
				<p class="text-sm text-muted-foreground">
					Self-hosted Sepia is free forever and feature-identical. Hosted is the zero-ops option —
					your escape hatch is always open.
				</p>
			</CardContent>
		</Card>
	{:else}
		<Skeleton class="h-40 w-full" />
	{/if}
</div>
