<script lang="ts">
	import * as Tabs from '$lib/components/ui/tabs/index.js';
	import { page } from '$app/state';
	import type { SectionTab } from '$lib/section-tabs.js';

	let {
		items,
		label
	}: {
		items: SectionTab[];
		/** Accessible name for the tab list, e.g. "Entity views". */
		label: string;
	} = $props();

	// The active tab is derived from the URL, never from local state — the URL
	// is the single source of truth for which view you are looking at.
	const active = $derived(items.find((i) => i.href === page.url.pathname)?.href ?? '');

	// `aria-current="page"` is added for free: the primitive marks the trigger
	// whose value matches `active`, and we render the trigger AS the link.
</script>

<Tabs.Root value={active}>
	<Tabs.List variant="line" aria-label={label}>
		{#each items as item (item.href)}
			<Tabs.Trigger value={item.href} class="flex-none">
				{#snippet child({ props })}
					<a href={item.href} {...props}>{item.label}</a>
				{/snippet}
			</Tabs.Trigger>
		{/each}
	</Tabs.List>
</Tabs.Root>
