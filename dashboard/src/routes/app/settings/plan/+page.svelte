<script lang="ts">
	import { CreditCard, Globe, Monitor, LoaderCircle, CircleCheck } from '@lucide/svelte';
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
	import { toast } from 'svelte-sonner';
	import { getMe, createCheckout } from '$lib/remote/index.js';
	import { openCheckout } from '$lib/lemon';
	import { confirmPayment } from '$lib/payment-confirm';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';

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

	/**
	 * Fallback path when the overlay is blocked (popup/iframe policies): LS
	 * redirects here with ?checkout=success. The webhook may still be in
	 * flight — `confirmPayment()` polls until the plan actually flips and
	 * only claims success on a confirmed server read (U1).
	 *
	 * `billing.remote.ts` builds this exact URL as Lemon Squeezy's
	 * `redirect_url`, so the handler has to live on THIS route — the old
	 * handler lived on `/app/account`, which no longer exists.
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

<div class="space-y-6">
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

	{#if me?.current}
		{@const account = me.current}
		<Card>
			<CardHeader>
				<CardTitle class="flex items-center gap-2 text-base">
					<CreditCard class="size-4" /> Current plan
					{#if account.user.plan === 'pro'}
						<Badge class="bg-primary text-primary-foreground">Pro</Badge>
					{:else}
						<Badge variant="secondary">Free</Badge>
					{/if}
				</CardTitle>
				<CardDescription>
					{#if account.user.plan === 'pro'}
						Manage your subscription, billing, and invoices here.
					{:else}
						100 namespaces · 1,000,000 memories · unlimited Web AI connections — $50/yr.
						<span class="text-muted-foreground/80">AI editors always unlimited.</span>
					{/if}
				</CardDescription>
			</CardHeader>
			<CardContent class="space-y-5">
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
								{account.usage.memories.toLocaleString()} /
								{account.usage.limits.maxMemories.toLocaleString()}
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

					<!-- Web AI connections — the ONLY metered AI plane. The list and
					     the disconnect control live on Connect, next to the keys that
					     belong to the uncounted plane; this is the count only. -->
					<div class="space-y-1.5">
						<div class="flex items-baseline justify-between text-sm">
							<span class="font-medium">Web AI connections</span>
							{#if account.usage.limits.maxAiConnections === null}
								<span class="text-muted-foreground">
									{account.usage.ai_connections}
									<span class="text-xs font-normal opacity-70">/ unlimited</span>
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
								AI editors always unlimited.
							{:else}
								Manage your subscription, billing, and invoices here.
							{/if}
						</p>
					</div>
					<div class="flex flex-wrap items-center gap-2">
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
						<Button variant="outline" onclick={() => goto('/pricing')}>See pricing</Button>
					</div>
				</div>
			</CardContent>
		</Card>

		<!-- The one-paragraph version of the two-plane explanation. The full
		     version, with the connection list, is on Connect — written once. -->
		<Card>
			<CardHeader>
				<CardTitle class="text-base">What counts toward the limit?</CardTitle>
			</CardHeader>
			<CardContent class="space-y-3 text-sm text-muted-foreground">
				<p class="flex flex-wrap items-center gap-2">
					<Globe class="size-4 shrink-0 text-violet-600 dark:text-violet-400" />
					Web AI connections count toward your limit. Local editors and MCP clients never do.
				</p>
				<p class="flex flex-wrap items-center gap-2">
					<Monitor class="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
					Editors — Claude Code, Cursor, Zed, Copilot, Codex, OpenCode — use a bearer token and are unlimited
					on every plan.
				</p>
				<Separator />
				<p class="text-xs">
					Connect and disconnect Web AIs on the
					<a href="/app/connect" class="font-medium text-foreground underline underline-offset-2"
						>Connect</a
					>
					page.
				</p>
			</CardContent>
		</Card>
	{:else}
		<Skeleton class="h-40 w-full" />
	{/if}
</div>
