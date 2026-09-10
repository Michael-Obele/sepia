<script lang="ts">
	import favicon from '$lib/assets/favicon.svg?no-inline';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { LayoutDashboard, LogIn, ArrowRight } from '@lucide/svelte';

	let { data, children } = $props();
	let authed = $derived(Boolean(data.user));
</script>

<!-- Shared header — public marketing pages — auth-aware -->
<header
	class="sticky top-0 z-20 border-b border-border/40 bg-background/80 backdrop-blur supports-backdrop-filter:bg-background/60"
>
	<div class="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3.5">
		<a href="/" class="flex items-center gap-2.5">
			<img src={favicon} alt="" class="size-7" />
			<span class="text-sm font-semibold tracking-tight">Sepia</span>
		</a>
		<div class="flex items-center gap-3 sm:gap-5">
			<nav class="hidden items-center gap-5 text-sm text-muted-foreground sm:flex">
				<a href="/" class="transition-colors hover:text-foreground">Home</a>
				<a href="/pricing" class="transition-colors hover:text-foreground">Pricing</a>
			</nav>
			<nav class="flex items-center gap-5 text-sm text-muted-foreground sm:hidden">
				<a href="/pricing" class="transition-colors hover:text-foreground">Pricing</a>
			</nav>
			<div class="hidden h-4 w-px bg-border/60 sm:block" aria-hidden="true"></div>
			{#if authed}
				<div class="flex items-center gap-2">
					<Badge
						variant="secondary"
						class="hidden gap-1.5 bg-emerald-500/10 text-emerald-700 ring-1 ring-emerald-500/20 sm:inline-flex dark:bg-emerald-500/15 dark:text-emerald-400"
					>
						<span class="size-1.5 animate-pulse rounded-full bg-emerald-500"></span>
						Signed in
					</Badge>
					<span
						class="size-1.5 animate-pulse rounded-full bg-emerald-500 sm:hidden"
						aria-hidden="true"
					></span>
					<Button href="/app" size="sm" class="gap-1.5">
						<LayoutDashboard class="size-3.5" />
						<span class="hidden sm:inline">Dashboard</span>
						<span class="sm:hidden">App</span>
						<ArrowRight class="size-3.5 opacity-60" />
					</Button>
				</div>
			{:else}
				<Button href="/app" size="sm" class="gap-1.5">
					<LogIn class="size-3.5" />
					Sign in
				</Button>
			{/if}
		</div>
	</div>
</header>

{@render children()}

<!-- Shared footer — public marketing pages -->
<footer class="border-t border-border/40">
	<div
		class="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-sm text-muted-foreground"
	>
		<div class="flex items-center gap-2.5">
			<img src={favicon} alt="" class="size-6" />
			<span>Sepia — memory server for AI agents</span>
		</div>
		<div class="flex items-center gap-5">
			<a
				href="https://github.com/Michael-Obele/sepia"
				target="_blank"
				rel="noopener"
				class="transition-colors hover:text-foreground"
			>
				GitHub
			</a>
			<a href="/pricing" class="transition-colors hover:text-foreground">Pricing</a>
			<a href="/app" class="transition-colors hover:text-foreground">Dashboard</a>
		</div>
	</div>
</footer>
