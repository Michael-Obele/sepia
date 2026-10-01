<script lang="ts">
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import { page } from '$app/state';
	import {
		LayoutDashboard,
		Layers,
		Boxes,
		MessagesSquare,
		Plug,
		Settings,
		LogOut,
		UserRound,
		BrainCircuit
	} from '@lucide/svelte';
	import { signOut } from '$lib/remote/index.js';
	import { goto, invalidateAll } from '$app/navigation';
	import UserAvatar from '$lib/components/user-avatar.svelte';
	import type { UserRow } from '@sepia/shared';

	/** The signed-in user, so the footer can show their face + name. */
	let { user }: { user: UserRow | null } = $props();

	type NavItem = { href: string; label: string; icon: typeof LayoutDashboard };

	/**
	 * Two groups, six items. The split is the user's own: the data their AIs
	 * wrote, and how it is wired up. Home, Pricing and GitHub were here until
	 * 2026-10-01 — the brand already covers "home", and the other two are
	 * reachable from Settings → About and Settings → Plan & usage. Mixing
	 * external links into an app nav is its own anti-pattern, and at 13 items
	 * in 3 groups the nav was carrying destinations it had no business owning.
	 */
	const memory: NavItem[] = [
		{ href: '/app', label: 'Overview', icon: LayoutDashboard },
		{ href: '/app/memories', label: 'Memories', icon: Layers },
		{ href: '/app/entities', label: 'Entities', icon: Boxes },
		{ href: '/app/conversations', label: 'Conversations', icon: MessagesSquare }
	];

	const configure: NavItem[] = [
		{ href: '/app/connect', label: 'Connect', icon: Plug },
		{ href: '/app/settings', label: 'Settings', icon: Settings }
	];

	// `/app` must match EXACTLY — a prefix match would light up Overview on
	// every /app/* page, since they all share that prefix.
	function isActive(href: string) {
		return href === '/app' ? page.url.pathname === '/app' : page.url.pathname.startsWith(href);
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
			<Sidebar.GroupLabel>Your memory</Sidebar.GroupLabel>
			<Sidebar.Menu>
				{#each memory as item (item.href)}
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
			<Sidebar.GroupLabel>Configure</Sidebar.GroupLabel>
			<Sidebar.Menu>
				{#each configure as item (item.href)}
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
	</Sidebar.Content>
	<Sidebar.Footer>
		<Sidebar.Menu>
			<Sidebar.MenuItem>
				<!-- Identity row: the avatar is the fastest "who am I signed in as".
				     It goes to Settings → Profile, the one place account changes
				     are made — this used to be a separate /app/account route. -->
				<Sidebar.MenuButton onclick={() => goto('/app/settings')} tooltipContent="Settings">
					{#snippet child({ props })}
						<a href="/app/settings" {...props}>
							{#if user}
								<UserAvatar {user} class="size-8" />
								<div class="grid flex-1 text-left leading-tight">
									<span class="truncate font-medium">{user.name}</span>
									<span class="truncate text-xs text-muted-foreground">{user.email}</span>
								</div>
							{:else}
								<UserRound />
								<span>Not signed in</span>
							{/if}
						</a>
					{/snippet}
				</Sidebar.MenuButton>
			</Sidebar.MenuItem>
			<Sidebar.MenuItem>
				<Sidebar.MenuButton onclick={handleLogout} tooltipContent="Sign out">
					<LogOut />
					<span>Sign out</span>
				</Sidebar.MenuButton>
			</Sidebar.MenuItem>
		</Sidebar.Menu>
	</Sidebar.Footer>
</Sidebar.Root>
