<script lang="ts">
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import { page } from '$app/state';
	import {
		Search,
		Layers,
		ScrollText,
		Boxes,
		Network,
		MessagesSquare,
		Plug,
		Settings,
		LogOut,
		UserRound,
		Activity,
		BrainCircuit,
		House,
		CreditCard,
		ExternalLink
	} from '@lucide/svelte';
	import { signOut } from '$lib/remote/index.js';
	import { goto, invalidateAll } from '$app/navigation';

	type NavItem = { href: string; label: string; icon: typeof Search; external?: boolean };

	/** Primary in-app routes (grouped — full IA rethink tracked separately) */
	const workspace: NavItem[] = [
		{ href: '/app', label: 'Search', icon: Search },
		{ href: '/app/memories', label: 'Memories', icon: Layers },
		{ href: '/app/briefing', label: 'Briefing', icon: ScrollText },
		{ href: '/app/conversations', label: 'Conversations', icon: MessagesSquare },
		{ href: '/app/entities', label: 'Entities', icon: Boxes },
		{ href: '/app/graph', label: 'Graph', icon: Network },
		{ href: '/app/connect', label: 'Connect an AI', icon: Plug }
	];

	/** Personal config routes */
	const account: NavItem[] = [
		{ href: '/app/settings', label: 'Settings', icon: Settings },
		{ href: '/app/account', label: 'Account', icon: UserRound },
		{ href: '/app/telemetry', label: 'Telemetry', icon: Activity }
	];

	/** Public/marketing routes so logged-in users can reach them without going home first */
	const site: NavItem[] = [
		{ href: '/', label: 'Home', icon: House },
		{ href: '/pricing', label: 'Pricing', icon: CreditCard },
		{
			href: 'https://github.com/Michael-Obele/sepia',
			label: 'GitHub',
			icon: ExternalLink,
			external: true
		}
	];

	function isActive(href: string) {
		if (href === '/') return page.url.pathname === '/';
		if (href === '/app') return page.url.pathname === '/app';
		if (href.startsWith('http')) return false;
		return page.url.pathname.startsWith(href);
	}

	async function handleLogout() {
		await signOut();
		await invalidateAll();
		await goto('/');
	}
</script>

<Sidebar.Root>
	<Sidebar.Header>
		<Sidebar.Menu>
			<Sidebar.MenuItem>
				<Sidebar.MenuButton size="lg" class="gap-2">
					{#snippet child({ props })}
						<a href="/" {...props}>
							<div
								class="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground"
							>
								<BrainCircuit class="size-4" />
							</div>
							<div class="grid flex-1 text-left text-sm leading-tight">
								<span class="truncate font-semibold">Sepia</span>
								<span class="truncate text-xs text-muted-foreground">Memory server</span>
							</div>
						</a>
					{/snippet}
				</Sidebar.MenuButton>
			</Sidebar.MenuItem>
		</Sidebar.Menu>
	</Sidebar.Header>
	<Sidebar.Content>
		<Sidebar.Group>
			<Sidebar.GroupLabel>Workspace</Sidebar.GroupLabel>
			<Sidebar.Menu>
				{#each workspace as item (item.href)}
					<Sidebar.MenuItem>
						<Sidebar.MenuButton isActive={isActive(item.href)} tooltipContent={item.label}>
							{#snippet child({ props })}
								<a href={item.href} {...props}>
									<item.icon />
									<span>{item.label}</span>
								</a>
							{/snippet}
						</Sidebar.MenuButton>
					</Sidebar.MenuItem>
				{/each}
			</Sidebar.Menu>
		</Sidebar.Group>
		<Sidebar.Group>
			<Sidebar.GroupLabel>Account</Sidebar.GroupLabel>
			<Sidebar.Menu>
				{#each account as item (item.href)}
					<Sidebar.MenuItem>
						<Sidebar.MenuButton isActive={isActive(item.href)} tooltipContent={item.label}>
							{#snippet child({ props })}
								<a href={item.href} {...props}>
									<item.icon />
									<span>{item.label}</span>
								</a>
							{/snippet}
						</Sidebar.MenuButton>
					</Sidebar.MenuItem>
				{/each}
			</Sidebar.Menu>
		</Sidebar.Group>
		<Sidebar.Group>
			<Sidebar.GroupLabel>Sepia</Sidebar.GroupLabel>
			<Sidebar.Menu>
				{#each site as item (item.href)}
					<Sidebar.MenuItem>
						<Sidebar.MenuButton tooltipContent={item.label}>
							{#snippet child({ props })}
								{#if item.external}
									<a href={item.href} target="_blank" rel="noopener noreferrer" {...props}>
										<item.icon />
										<span>{item.label}</span>
									</a>
								{:else}
									<a href={item.href} {...props}>
										<item.icon />
										<span>{item.label}</span>
									</a>
								{/if}
							{/snippet}
						</Sidebar.MenuButton>
					</Sidebar.MenuItem>
				{/each}
			</Sidebar.Menu>
		</Sidebar.Group>
	</Sidebar.Content>
	<Sidebar.Footer>
		<Sidebar.Menu>
			<Sidebar.MenuItem>
				<Sidebar.MenuButton onclick={handleLogout} tooltipContent="Sign out">
					<LogOut />
					<span>Sign out</span>
				</Sidebar.MenuButton>
			</Sidebar.MenuItem>
		</Sidebar.Menu>
	</Sidebar.Footer>
</Sidebar.Root>
