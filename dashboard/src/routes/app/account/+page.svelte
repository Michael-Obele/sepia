<script lang="ts">
	import { KeyRound, Copy, Check, Trash2, ShieldCheck, Sparkles, CreditCard } from '@lucide/svelte';
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
	import { toast } from 'svelte-sonner';
	import { getMe } from '$lib/remote/index.js';
	import { auth, isAuthed, logout } from '$lib/auth.svelte';
	import { authClient } from '$lib/auth-client';
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

	async function loadKeys() {
		if (!isAuthed()) return;
		keysLoaded = false;
		try {
			const { data, error: listError } = await authClient.apiKey.list();
			if (listError) throw new Error(listError.message);
			keys = (data?.apiKeys ?? []).map((k) => ({
				id: k.id,
				name: k.name ?? 'Untitled key',
				createdAt: String(k.createdAt),
				lastRequest: k.lastRequest ? String(k.lastRequest) : null
			}));
		} catch (e) {
			toast.error((e as Error)?.message ?? 'Failed to load API keys');
		} finally {
			keysLoaded = true;
		}
	}

	async function createKey() {
		creatingKey = true;
		newKey = null;
		try {
			const { data, error: createError } = await authClient.apiKey.create({
				name: `key-${new Date().toISOString().slice(0, 10)}`
			});
			if (createError) throw new Error(createError.message);
			newKey = data?.key ?? null;
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
			const { error: deleteError } = await authClient.apiKey.delete({ keyId: id });
			if (deleteError) throw new Error(deleteError.message);
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

					<div class="space-y-1.5">
						<div class="flex items-baseline justify-between text-sm">
							<span class="font-medium">AI connections</span>
							{#if account.usage.limits.maxAiConnections === null}
								<span class="text-muted-foreground">
									{account.usage.ai_connections} <span class="text-xs">/ unlimited</span>
								</span>
							{:else}
								<span class="text-muted-foreground">
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
								100 namespaces · 1,000,000 memories · unlimited AI connections — $50/yr.
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

		<Card>
			<CardHeader>
				<CardTitle class="flex items-center gap-2">
					<KeyRound class="size-4" /> API keys
				</CardTitle>
				<CardDescription>
					Use an API key as the bearer token for local editors (Claude Code, Cursor, Zed, Copilot).
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
					<p class="text-sm text-muted-foreground">No API keys yet.</p>
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
