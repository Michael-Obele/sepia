<script lang="ts">
	import {
		KeyRound,
		Copy,
		Check,
		CircleCheck,
		Trash2,
		Pencil,
		ShieldCheck,
		Sparkles,
		CreditCard,
		Globe,
		Monitor,
		Info,
		Terminal,
		Unlink,
		PlugZap,
		Clock3,
		LoaderCircle
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
	import * as Alert from '$lib/components/ui/alert/index.js';
	import { Progress } from '$lib/components/ui/progress/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import ApiKeyDialog from '$lib/components/api-key-form-dialog.svelte';
	import UserAvatar from '$lib/components/user-avatar.svelte';
	import AvatarShareCard from '$lib/components/avatar-share-card.svelte';
	import { toast } from 'svelte-sonner';
	import {
		getMe,
		listApiKeys,
		deleteApiKey,
		listConnections,
		disconnectConnection,
		signOut,
		signOutOtherSessions,
		createCheckout
	} from '$lib/remote/index.js';
	import { openCheckout } from '$lib/lemon';
	import { confirmPayment } from '$lib/payment-confirm';
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';

	let { data } = $props();
	const isAuthed = () => Boolean(data.user);

	const me = $derived(isAuthed() ? getMe() : null);

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

	/**
	 * Upgrade: open the Lemon Squeezy checkout overlay. The plan itself is
	 * flipped by the webhook (source of truth), so the only local feedback we
	 * owe is a VERIFIED re-read of the plan — hence `confirmPayment()`, which
	 * polls until the flip is visible instead of asserting it (U1).
	 *
	 * "Manage plan" (already Pro) still toasts: the customer portal is a
	 * deliberate follow-up, not an oversight (docs/plans/2026-09-29-
	 * lemon-squeezy-billing-design.md → Out of scope).
	 */
	let upgrading = $state(false);
	/** Durable payment proof — outlives the success toast (critique HIGH-2). */
	let paymentConfirmed = $state(false);
	async function upgrade() {
		// `account` is template-scoped ({@const}); the script reads the same
		// resource. `current` is undefined only while loading — and the button
		// isn't reachable then.
		const plan = me?.current?.user.plan ?? 'free';
		if (plan !== 'free') {
			toast.info('Billing portal coming soon', {
				description: 'Cancel or change your plan here once the portal lands.'
			});
			return;
		}
		if (upgrading) return;
		upgrading = true;
		try {
			// Annual is the default here (the pricing page's toggle defaults
			// to annual too, and it's the plan we advertise).
			const { url } = await createCheckout('annual');
			const outcome = await openCheckout(url);
			switch (outcome.status) {
				case 'completed':
					// Poll until the webhook's flip is actually visible; the
					// success toast is only shown on a confirmed read (U1),
					// and the banner persists after the toast fades (HIGH-2).
					paymentConfirmed = await confirmPayment();
					break;
				case 'dismissed':
					// Normal — they changed their mind. Say nothing.
					break;
				case 'redirected':
					// Navigating to LS's hosted checkout; the page is going away.
					toast.loading('Taking you to secure checkout…');
					break;
				case 'failed':
					toast.error(outcome.reason || 'Could not start checkout');
					break;
			}
		} catch (e) {
			toast.error((e as Error)?.message ?? 'Could not start checkout');
		} finally {
			upgrading = false;
		}
	}

	let copied = $state('');
	let newKey = $state<string | null>(null);
	// Naming a key happens in a modal: create, and rename an existing one.
	let createKeyOpen = $state(false);
	let renameKeyOpen = $state(false);
	let editingKey = $state<{ id: string; name: string } | null>(null);
	let keys = $state<
		Array<{
			id: string;
			name: string;
			start: string | null;
			createdAt: string;
			lastRequest: string | null;
		}>
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
			local: boolean;
		}>
	>([]);
	let connectionsLoaded = $state(false);
	let disconnectingId = $state<string | null>(null);

	/**
	 * Only non-local connections count toward the plan. Local (loopback) clients
	 * are editors — LM Studio, Cursor, … — and `countAiConnections` excludes them
	 * from the meter above, so this keeps the list and the numbers consistent.
	 */
	const countedConnections = $derived(connections.filter((c) => !c.local).length);
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
			keys = await listApiKeys();
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
			connections = await listConnections();
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
			await disconnectConnection(clientId);
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

	async function deleteKey(id: string) {
		if (!confirm('Delete this API key? Anything using it will stop working.')) return;
		try {
			await deleteApiKey(id);
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

	async function handleLogout() {
		await signOut();
		await invalidateAll();
		await goto('/');
	}

	/** Revoke every other session for this account — the post-leak escape hatch. */
	let signingOutOthers = $state(false);
	async function handleSignOutOthers() {
		signingOutOthers = true;
		try {
			await signOutOtherSessions();
			toast.success('Signed out of all other sessions');
		} catch (e) {
			toast.error((e as Error)?.message ?? 'Failed to sign out other sessions');
		} finally {
			signingOutOthers = false;
		}
	}

	$effect(() => {
		if (isAuthed() && !keysLoaded) loadKeys();
	});
	$effect(() => {
		if (isAuthed() && !connectionsLoaded) loadConnections();
	});

	/**
	 * Fallback path when the overlay is blocked (popup/iframe policies): LS
	 * redirects here with ?checkout=success. The webhook may still be in
	 * flight — `confirmPayment()` polls until the plan actually flips and
	 * only claims success on a confirmed server read (U1).
	 */
	let checkoutHandled = $state(false);
	$effect(() => {
		if (checkoutHandled) return;
		if (page.url.searchParams.get('checkout') !== 'success') return;
		checkoutHandled = true;
		void (async () => {
			paymentConfirmed = await confirmPayment();
			// Drop the query param so a refresh doesn't re-toast.
			const url = new URL(page.url);
			url.searchParams.delete('checkout');
			await goto(url, { replaceState: true, keepFocus: true });
		})();
	});
</script>

<svelte:head>
	<title>Account — Sepia</title>
</svelte:head>

<div class="mx-auto space-y-6">
	{#if paymentConfirmed}
		<!-- Durable proof of purchase — a toast that fades in 4s is not evidence. -->
		<Alert.Root class="border-emerald-500/30 bg-emerald-500/10">
			<CircleCheck />
			<Alert.Title>You’re on Pro — payment confirmed</Alert.Title>
			<Alert.Description>
				100 namespaces, 1,000,000 memories and unlimited Web AI connections are now active.
			</Alert.Description>
		</Alert.Root>
	{/if}
	<div class="flex items-center justify-between">
		<div>
			<h1 class="text-2xl font-semibold tracking-tight">Account</h1>
			<p class="text-sm text-muted-foreground">Your plan, usage, and API keys.</p>
		</div>
		<div class="flex items-center gap-2">
			<Button variant="ghost" size="sm" onclick={handleSignOutOthers} disabled={signingOutOthers}>
				{signingOutOthers ? 'Signing out…' : 'Sign out other sessions'}
			</Button>
			<Button variant="outline" onclick={handleLogout}>Sign out</Button>
		</div>
	</div>

	{#if me?.current}
		{@const account = me.current}
		<Card>
			<CardHeader>
				<CardTitle class="flex items-center gap-3">
					<UserAvatar user={account.user} class="size-10" />
					<span>{account.user.name}</span>
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
											class="border-violet-500/30 bg-violet-500/10 font-mono text-[11px] tracking-wider text-violet-700 uppercase dark:text-violet-300"
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
												Perplexity, Le Chat. Each account you authorize counts as 1, so two accounts
												of the same provider count as 2. Local apps (LM Studio, Cursor) and editors
												that use an API key never count.
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
									Grok, Gemini, Perplexity, Le Chat. Each account = 1 connection. Local apps (LM
									Studio, Cursor) don’t count. Free: 2 · Pro: unlimited.
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
											No Web AI connections yet — add one on the
											<a
												href="/app/connect"
												class="underline underline-offset-2 hover:text-foreground">Connect</a
											> page.
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
															{#if c.local}
																<Badge variant="outline" class="text-muted-foreground"
																	>Local — doesn’t count</Badge
																>
															{/if}
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
										{#if countedConnections > 1}
											<p class="mt-2 text-xs text-muted-foreground">
												<PlugZap class="mr-1 inline size-3" />
												You have {countedConnections} Web AI connections. Each counts toward your limit
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
								class="inline-flex items-center gap-1.5 rounded-full border bg-muted/50 px-2.5 py-1 font-mono text-[11px] tracking-wider text-muted-foreground uppercase"
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

				<!-- Upgrade CTA — free opens the checkout overlay; pro opens the
				     portal (toast until the portal lands) -->
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
					<Button onclick={upgrade} disabled={upgrading} class="gap-1.5">
						{#if upgrading}
							<LoaderCircle class="size-4 animate-spin" />
							Starting…
						{:else}
							<CreditCard class="size-4" />
							{#if account.user.plan === 'free'}
								Upgrade to Pro
							{:else}
								Manage plan
							{/if}
						{/if}
					</Button>
				</div>
			</CardContent>
		</Card>

		<!-- The big, shareable portrait — see avatar-share-card.svelte -->
		<AvatarShareCard user={account.user} plan={account.user.plan} />

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
						{#if pendingDisconnect}
							<!-- Two accounts of one provider share a name, so identify the exact row. -->
							<span class="mt-2 block font-mono text-xs">
								{pendingDisconnect.clientId.slice(0, 8)}…
							</span>
						{/if}
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
				<Button onclick={() => (createKeyOpen = true)}>Create API key</Button>
				<ApiKeyDialog
					bind:open={createKeyOpen}
					onCreated={(created) => {
						newKey = created.key;
					}}
					onSaved={loadKeys}
				/>
				<ApiKeyDialog bind:open={renameKeyOpen} editing={editingKey} onSaved={loadKeys} />
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
										{#if key.start}<code class="font-mono text-foreground">{key.start}…</code> ·
										{/if}Created {new Date(key.createdAt).toLocaleDateString()}
										{#if key.lastRequest}
											· last used {new Date(key.lastRequest).toLocaleDateString()}{/if}
									</p>
								</div>
								<div class="flex items-center gap-1">
									<Button
										size="sm"
										variant="ghost"
										aria-label={`Rename ${key.name}`}
										onclick={() => {
											editingKey = { id: key.id, name: key.name };
											renameKeyOpen = true;
										}}
									>
										<Pencil class="size-4" />
									</Button>
									<Button
										size="sm"
										variant="ghost"
										aria-label={`Delete ${key.name}`}
										onclick={() => deleteKey(key.id)}
									>
										<Trash2 class="size-4" />
									</Button>
								</div>
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
