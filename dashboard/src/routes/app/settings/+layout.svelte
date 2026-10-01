<script lang="ts">
	import SettingsNav from '$lib/components/settings-nav.svelte';

	let { children } = $props();
</script>

<svelte:head><title>Settings — Sepia</title></svelte:head>

<div class="max-w-full min-w-0 space-y-6">
	<div class="flex flex-col gap-2">
		<h1 class="text-2xl font-semibold tracking-tight">Settings</h1>
		<p class="text-sm text-muted-foreground">Your profile, plan, preferences, and data.</p>
	</div>

	<div class="flex flex-col gap-6 md:flex-row md:gap-10">
		<aside class="w-full shrink-0 md:w-52">
			<SettingsNav />
		</aside>
		<div class="min-w-0 flex-1 md:max-w-250">
			{@render children()}
		</div>
	</div>
</div>
