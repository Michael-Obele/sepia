<script lang="ts">
	import { page } from '$app/state';
	import { UserRound, CreditCard, SlidersHorizontal, Database, Info } from '@lucide/svelte';

	type Item = { href: string; label: string; icon: typeof UserRound };

	/**
	 * Settings is a list-detail layout, so the sub-nav is a plain list of links
	 * rather than more router groups. The index route needs an EXACT match —
	 * a prefix match would keep `Profile` lit while you are on `Plan & usage`,
	 * because every path starts with `/app/settings`.
	 */
	const items: Item[] = [
		{ href: '/app/settings', label: 'Profile', icon: UserRound },
		{ href: '/app/settings/plan', label: 'Plan & usage', icon: CreditCard },
		{ href: '/app/settings/preferences', label: 'Preferences', icon: SlidersHorizontal },
		{ href: '/app/settings/data', label: 'Data & privacy', icon: Database },
		{ href: '/app/settings/about', label: 'About', icon: Info }
	];

	function isActive(href: string) {
		return href === '/app/settings'
			? page.url.pathname === '/app/settings'
			: page.url.pathname.startsWith(href);
	}
</script>

<nav aria-label="Settings sections" class="flex flex-col gap-1">
	{#each items as item (item.href)}
		<a
			href={item.href}
			aria-current={isActive(item.href) ? 'page' : undefined}
			class="flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent hover:text-accent-foreground {isActive(
				item.href
			)
				? 'bg-accent font-medium text-accent-foreground'
				: 'text-muted-foreground'}"
		>
			<item.icon class="size-4 shrink-0" />
			<span class="truncate">{item.label}</span>
		</a>
	{/each}
</nav>
