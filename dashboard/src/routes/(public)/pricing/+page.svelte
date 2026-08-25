<script lang="ts">
	import {
		Check,
		Minus,
		Sparkles,
		Lock,
		ShieldCheck,
		Download,
		RefreshCw,
		ArrowRight,
		Infinity,
		BadgeCheck,
		Code
	} from '@lucide/svelte';
	import { buttonVariants } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';

	let billing = $state<'annual' | 'monthly'>('annual');

	const plans = [
		{
			name: 'Free',
			tagline: 'Start with a real memory graph — not a demo.',
			price: '$0',
			period: 'forever',
			cta: 'Start free — no card',
			variant: 'outline' as const,
			highlight: false,
			features: [
				'1 namespace',
				'1,000 memories',
				'1 AI connection',
				'Unlimited reads, search & export',
				'Conversation ingest — switch AIs mid-task',
				'Self-host free forever, feature-identical'
			]
		},
		{
			name: 'Pro',
			tagline: 'One graph for every AI you use. Locked in at beta pricing.',
			price: '$50',
			period: 'billed annually',
			monthlyPrice: '$8',
			monthlyPeriod: 'billed monthly',
			cta: 'Get Pro',
			variant: 'default' as const,
			highlight: true,
			features: [
				'Everything in Free',
				'100 namespaces',
				'1,000,000 memories (fair use)',
				'Unlimited AI connections',
				'Zero-ops hosting — backups, no cold starts',
				'Priority support + early access to new features'
			]
		}
	];

	const comparison = [
		{
			group: 'Core',
			rows: [
				{ label: 'Knowledge graph (entities, relations, memories)', free: true, pro: true },
				{ label: 'Unified search + graph traversal', free: true, pro: true },
				{ label: 'Auto-maintenance — dedupe, decay, purge', free: true, pro: true },
				{ label: 'Conversation ingest — resume on any AI', free: true, pro: true },
				{ label: 'MCP + OAuth 2.1 for web AIs', free: true, pro: true },
				{ label: 'Export everything, JSON', free: true, pro: true }
			]
		},
		{
			group: 'Scale',
			rows: [
				{ label: 'Namespaces', free: '1', pro: '100' },
				{ label: 'Memories', free: '1,000', pro: '1,000,000' },
				{ label: 'AI connections', free: '1', pro: 'Unlimited' }
			]
		},
		{
			group: 'Support & trust',
			rows: [
				{ label: 'Hosted, zero-ops (backups, uptime)', free: true, pro: true },
				{ label: 'Priority support', free: false, pro: true },
				{ label: 'Beta pricing locked for life of subscription', free: false, pro: true },
				{ label: 'Early access to new features', free: false, pro: true }
			]
		}
	];

	const anchor = [
		{ name: 'Basic Memory', price: '$15/seat/mo' },
		{ name: 'Mem0', price: 'from $19/mo' },
		{ name: 'Letta', price: '$20/mo' },
		{ name: 'Zep', price: 'from $104/mo' },
		{ name: 'Sepia Hosted', price: '$4.17/mo', us: true }
	];

	const faqs = [
		{
			q: 'Is self-hosting still free?',
			a: 'Yes — forever, and feature-identical. Sepia is open source. Hosted is the zero-ops option; self-hosted is your escape hatch. We will never break that promise.'
		},
		{
			q: 'What happens when I hit my free limits?',
			a: 'Reads, search, and export are never blocked. Only new writes pause, with a friendly upgrade nudge at ~80% of each limit. Your data stays yours either way.'
		},
		{
			q: 'Can I cancel or delete my account?',
			a: 'Any time, in two clicks. Export everything as JSON first if you want to keep it. No lock-in, no retention games — that is the whole point of this product.'
		},
		{
			q: 'Am I on a countdown trial?',
			a: 'No. The free tier is permanent, not a 14-day clock. We would rather earn your trust than trap you with a deadline.'
		},
		{
			q: 'What does “beta pricing” mean?',
			a: 'Pro is $50/yr ($8/mo) for the life of your subscription — it never goes up for you, and early users are grandfathered through any future changes.'
		},
		{
			q: 'Why is it cheaper than everything else?',
			a: 'One plan, no sales team, infrastructure that costs us single-digit dollars a month per user. We prefer growing trust over margin — that is the only moat a memory product has.'
		}
	];
</script>

<svelte:head>
	<title>Sepia — Pricing</title>
	<meta
		name="description"
		content="Sepia Hosted — one memory graph for every AI you use. Free tier for your first 1,000 memories, Pro at $50/yr (≈ $4.17/mo). Locked-in beta pricing, export everything, cancel anytime. Self-host free forever."
	/>
</svelte:head>

<!-- Hero + toggle -->
<section class="relative overflow-hidden px-4 pt-20 pb-12 sm:pt-28">
	<div
		class="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(212,149,106,0.09)_0%,transparent_55%),radial-gradient(ellipse_at_top_right,rgba(212,149,106,0.05)_0%,transparent_55%)]"
		aria-hidden="true"
	></div>

	<div class="relative z-10 mx-auto max-w-5xl text-center">
		<Badge class="gap-1.5 bg-brand/15 py-1.5 text-brand ring-1 ring-brand/25">
			<Sparkles class="size-3.5" /> Hosted · Beta pricing
		</Badge>

		<h1
			class="mt-6 text-4xl font-semibold tracking-tight text-foreground sm:text-5xl"
			style="letter-spacing: -0.03em"
		>
			One graph. Every AI.
			<br />
			<span class="bg-linear-to-r from-brand to-amber-200 bg-clip-text text-transparent"
				>One honest price.</span
			>
		</h1>

		<p class="mx-auto mt-5 text-lg text-muted-foreground">
			Your first 1,000 memories are free — forever, not a trial. When you outgrow them, Pro is
			{#if billing === 'annual'}
				<span class="font-medium text-foreground">$4.17/month</span> billed annually.
			{:else}
				<span class="font-medium text-foreground">$8/month</span> — or $4.17/month billed annually.
			{/if}
		</p>

		<!-- Billing toggle -->
		<div
			class="mt-10 inline-flex items-center gap-4 rounded-full border border-border/60 bg-card/40 px-5 py-3 backdrop-blur-sm"
		>
			<span class={billing === 'monthly' ? 'font-medium text-foreground' : 'text-muted-foreground'}
				>Monthly</span
			>
			<Switch
				checked={billing === 'annual'}
				onCheckedChange={(checked) => (billing = checked ? 'annual' : 'monthly')}
				aria-label="Toggle annual billing"
			/>
			<span class={billing === 'annual' ? 'font-medium text-foreground' : 'text-muted-foreground'}
				>Annual</span
			>
			<Badge class="gap-1 bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/15">
				Save $46/yr
			</Badge>
		</div>
	</div>
</section>

<!-- Plans -->
<section class="relative px-4 pb-8">
	<div class="mx-auto grid max-w-5xl gap-5 md:grid-cols-2">
		{#each plans as plan (plan.name)}
			<div
				class={plan.highlight
					? 'relative flex flex-col rounded-2xl border border-brand/40 bg-linear-to-b from-brand/10 via-card/60 to-card/60 p-7 shadow-xl ring-1 shadow-brand/5 ring-brand/20'
					: 'relative flex flex-col rounded-2xl border border-border/60 bg-card/40 p-7 backdrop-blur-sm'}
			>
				{#if plan.highlight}
					<Badge
						class="absolute -top-3 left-1/2 -translate-x-1/2 gap-1 bg-brand px-3 py-1 text-primary-foreground hover:bg-brand"
					>
						<Lock class="size-3" /> Best value
					</Badge>
				{/if}

				<div class="flex items-center gap-2">
					<h2 class="text-lg font-semibold tracking-tight">{plan.name}</h2>
					{#if plan.highlight}
						<Infinity class="size-4 text-brand" />
					{/if}
				</div>
				<p class="mt-1 text-sm text-muted-foreground">{plan.tagline}</p>

				<div class="mt-6 flex items-baseline gap-2">
					{#if plan.highlight && billing === 'monthly'}
						<span class="font-mono text-5xl font-semibold tracking-tight tabular-nums"
							>{plan.monthlyPrice}</span
						>
						<span class="text-muted-foreground">/month</span>
					{:else if plan.highlight}
						<span class="font-mono text-5xl font-semibold tracking-tight tabular-nums"
							>{plan.price}</span
						>
						<span class="text-muted-foreground">/year</span>
					{:else}
						<span class="font-mono text-5xl font-semibold tracking-tight tabular-nums"
							>{plan.price}</span
						>
						<span class="text-muted-foreground">{plan.period}</span>
					{/if}
				</div>
				{#if plan.highlight}
					<p class="mt-2 text-sm text-muted-foreground">
						{#if billing === 'annual'}
							≈ $4.17/mo · locked in for the life of your subscription
						{:else}
							billed monthly · $4.17/mo when you switch to annual
						{/if}
					</p>
				{:else}
					<p class="mt-2 text-sm text-muted-foreground">No card. No countdown. Just a graph.</p>
				{/if}

				<ul class="mt-7 space-y-3">
					{#each plan.features as feature (feature)}
						<li class="flex items-start gap-2.5 text-sm">
							<Check class="mt-0.5 size-4 shrink-0 text-brand" />
							<span class="text-foreground/90">{feature}</span>
						</li>
					{/each}
				</ul>

				<div class="mt-8 flex flex-1 flex-col justify-end">
					<a
						href="/"
						class={buttonVariants({ variant: plan.variant, size: 'lg' }) + ' w-full gap-2'}
					>
						{plan.cta}
						<ArrowRight class="size-4" />
					</a>
					{#if plan.highlight}
						<p class="mt-3 text-center text-xs text-muted-foreground">
							Save $46/yr vs monthly · cancel anytime
						</p>
					{:else}
						<p class="mt-3 text-center text-xs text-muted-foreground">
							Upgrade when you outgrow it — never before
						</p>
					{/if}
				</div>
			</div>
		{/each}
	</div>

	<!-- Risk reversal strip -->
	<div
		class="mx-auto mt-8 flex max-w-5xl flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-muted-foreground"
	>
		<span class="flex items-center gap-2"
			><Download class="size-4 text-brand" /> Export everything</span
		>
		<span class="flex items-center gap-2"
			><ShieldCheck class="size-4 text-emerald-400" /> Private — no telemetry</span
		>
		<span class="flex items-center gap-2"
			><RefreshCw class="size-4 text-amber-400" /> Cancel anytime</span
		>
	</div>
</section>

<!-- Comparison table -->
<section class="relative px-4 py-24 sm:py-28">
	<div class="mx-auto max-w-5xl">
		<div class="text-center">
			<Badge variant="outline" class="mb-4 font-mono text-xs tracking-wider uppercase"
				>Free vs Pro</Badge
			>
			<h2 class="text-3xl font-semibold tracking-tight sm:text-4xl" style="letter-spacing: -0.03em">
				The difference is scale, not access.
			</h2>
			<p class="mt-4 text-muted-foreground">
				Both plans are the same product with the same rights. Pro simply removes the ceilings.
			</p>
		</div>

		<div class="mt-12 overflow-x-auto rounded-2xl border border-border/60 bg-card/30">
			<table class="w-full min-w-140 text-sm">
				<thead>
					<tr class="border-b border-border/60">
						<th class="p-4 text-left font-medium text-muted-foreground">Feature</th>
						<th class="w-28 p-4 text-center font-semibold">Free</th>
						<th class="w-28 p-4 text-center font-semibold text-brand">Pro</th>
					</tr>
				</thead>
				<tbody>
					{#each comparison as group (group.group)}
						<tr class="border-b border-border/40 bg-muted/20">
							<td
								colspan="3"
								class="px-4 py-2 font-mono text-xs tracking-wider text-muted-foreground uppercase"
							>
								{group.group}
							</td>
						</tr>
						{#each group.rows as row (row.label)}
							<tr class="border-b border-border/30 last:border-b-0">
								<td class="p-4 text-foreground/90">{row.label}</td>
								<td class="p-4 text-center">
									{#if row.free === true}
										<Check class="mx-auto size-4 text-brand" />
									{:else if row.free === false}
										<Minus class="mx-auto size-4 text-muted-foreground/40" />
									{:else}
										<span class="font-mono text-xs text-muted-foreground tabular-nums"
											>{row.free}</span
										>
									{/if}
								</td>
								<td class="p-4 text-center">
									{#if row.pro === true}
										<Check class="mx-auto size-4 text-brand" />
									{:else if row.pro === false}
										<Minus class="mx-auto size-4 text-muted-foreground/40" />
									{:else}
										<span class="font-mono text-xs font-medium text-foreground tabular-nums"
											>{row.pro}</span
										>
									{/if}
								</td>
							</tr>
						{/each}
					{/each}
				</tbody>
			</table>
		</div>
		<p class="mt-3 text-center text-xs text-muted-foreground">
			Fair-use applies to the 1,000,000-memory ceiling. Reads, search, and export are never limited.
		</p>
	</div>
</section>

<!-- Anchor: honest math -->
<section class="relative px-4 pb-24 sm:pb-32">
	<div class="mx-auto max-w-5xl">
		<div class="grid gap-10 md:grid-cols-2 md:items-center">
			<div>
				<Badge variant="outline" class="mb-4 font-mono text-xs tracking-wider uppercase"
					>The honest math</Badge
				>
				<h2
					class="text-3xl font-semibold tracking-tight sm:text-4xl"
					style="letter-spacing: -0.03em"
				>
					Less than a coffee a week.
				</h2>
				<p class="mt-4 text-muted-foreground">
					Hosted memory usually runs $15–25/month. We are one open-source product with no sales team
					and infrastructure that costs us single digits per user. So we charge what it costs, not
					what the market allows.
				</p>
				<p class="mt-4 flex items-center gap-2 text-sm text-foreground/80">
					<BadgeCheck class="size-4 text-emerald-400" />
					And if you ever prefer no dollars at all — self-host the same product, free, forever.
				</p>
			</div>

			<div class="rounded-2xl border border-border/60 bg-card/30">
				{#each anchor as row (row.name)}
					<div
						class={row.us
							? 'flex items-center justify-between rounded-xl border border-brand/40 bg-brand/10 px-5 py-3.5'
							: 'flex items-center justify-between border-b border-border/40 px-5 py-3.5 last:border-b-0'}
					>
						<span class={row.us ? 'font-medium text-foreground' : 'text-muted-foreground'}>
							{row.name}
						</span>
						<span
							class={row.us
								? 'font-mono text-sm font-semibold text-brand tabular-nums'
								: 'font-mono text-sm text-muted-foreground tabular-nums'}
						>
							{row.price}
						</span>
					</div>
				{/each}
			</div>
		</div>
	</div>
</section>

<!-- FAQ -->
<section class="relative border-t border-border/40 px-4 py-24 sm:py-28">
	<div class="mx-auto max-w-5xl">
		<div class="text-center">
			<h2 class="text-3xl font-semibold tracking-tight sm:text-4xl" style="letter-spacing: -0.03em">
				Fair questions.
			</h2>
			<p class="mt-4 text-muted-foreground">Straight answers — same as the product.</p>
		</div>

		<div class="mt-12 space-y-3">
			{#each faqs as faq (faq.q)}
				<details
					class="group rounded-xl border border-border/60 bg-card/30 px-5 py-4 transition-colors open:border-brand/30"
				>
					<summary
						class="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium text-foreground"
					>
						{faq.q}
						<span class="text-muted-foreground transition-transform group-open:rotate-45">+</span>
					</summary>
					<p class="mt-3 text-sm leading-relaxed text-muted-foreground">{faq.a}</p>
				</details>
			{/each}
		</div>
	</div>
</section>

<!-- Final CTA -->
<section class="relative overflow-hidden px-4 pb-28">
	<div class="relative z-10 mx-auto max-w-5xl text-center">
		<h2 class="text-3xl font-semibold tracking-tight sm:text-4xl" style="letter-spacing: -0.03em">
			Your AI starts at zero every session.
		</h2>
		<p class="mx-auto mt-4 text-muted-foreground">
			Give it a memory. The first 1,000 are on us — forever.
		</p>
		<div class="mt-8 flex flex-wrap items-center justify-center gap-3">
			<a href="/" class={buttonVariants({ size: 'lg' }) + ' gap-2 px-8'}>
				<Download class="size-4" /> Start free — no card
			</a>
			<a href="/" class={buttonVariants({ variant: 'outline', size: 'lg' }) + ' gap-2 px-8'}>
				<Code class="size-4" /> Self-host instead
			</a>
		</div>
		<p class="mt-4 text-xs text-muted-foreground">
			Export everything · delete anytime · cancel in two clicks
		</p>
	</div>
</section>
