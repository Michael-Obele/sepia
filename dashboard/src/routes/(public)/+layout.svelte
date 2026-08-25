<script lang="ts">
	import favicon from '$lib/assets/favicon.svg?no-inline';

	let { children } = $props();
</script>

<!-- Shared header — public marketing pages -->
<header class="relative z-20 border-b border-border/40">
	<div class="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
		<a href="/" class="flex items-center gap-2.5">
			<img src={favicon} alt="" class="size-7" />
			<span class="text-sm font-semibold tracking-tight">Sepia</span>
		</a>
		<nav class="flex items-center gap-5 text-sm text-muted-foreground">
			<a href="/" class="transition-colors hover:text-foreground">Home</a>
			<a href="/pricing" class="transition-colors hover:text-foreground" aria-current="page">
				Pricing
			</a>
		</nav>
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
