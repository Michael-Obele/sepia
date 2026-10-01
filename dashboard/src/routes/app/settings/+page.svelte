<script lang="ts">
	import { ShieldCheck, Sparkles, LogOut, KeyRound } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import UserAvatar from '$lib/components/user-avatar.svelte';
	import AvatarShareCard from '$lib/components/avatar-share-card.svelte';
	import { toast } from 'svelte-sonner';
	import { signOut, signOutOtherSessions } from '$lib/remote/index.js';
	import { goto, invalidateAll } from '$app/navigation';

	let { data } = $props();

	/** Sign out of THIS browser — the everyday action. */
	async function handleLogout() {
		await signOut();
		await invalidateAll();
		await goto('/');
	}

	/** Revoke every other session for this account — the post-leak escape hatch. */
	let signingOutOthers = $state(false);
	async function handleSignOutOthers() {
		signingOutOthers = true;
		try {
			await signOutOtherSessions();
			toast.success('Signed out of all other sessions');
		} catch (e) {
			toast.error((e as Error)?.message ?? 'Failed to sign out other sessions');
		} finally {
			signingOutOthers = false;
		}
	}
</script>

<div class="space-y-6">
	<Card>
		<CardHeader>
			<CardTitle class="flex items-center gap-3 text-base">
				<UserAvatar user={data.user} class="size-10" />
				<span>{data.user?.name ?? 'Not signed in'}</span>
				{#if data.user?.plan === 'pro'}
					<Badge class="gap-1 bg-primary text-primary-foreground">
						<Sparkles class="size-3" /> Pro
					</Badge>
				{:else}
					<Badge variant="secondary">Free</Badge>
				{/if}
			</CardTitle>
			<CardDescription>{data.user?.email ?? '—'}</CardDescription>
		</CardHeader>
	</Card>

	<!-- The big, shareable portrait — see avatar-share-card.svelte -->
	<AvatarShareCard user={data.user} plan={data.user?.plan} />

	<!-- Both sign-out actions live here and nowhere else, with labels that say
	     which one you are about to do: this browser, or every other one. -->
	<Card>
		<CardHeader>
			<CardTitle class="flex items-center gap-2 text-base">
				<ShieldCheck class="size-4" /> Sessions
			</CardTitle>
			<CardDescription>How this browser is signed in.</CardDescription>
		</CardHeader>
		<CardContent class="space-y-4">
			<div class="flex flex-wrap items-center gap-2">
				<Button variant="outline" onclick={handleLogout}>
					<LogOut class="size-4" /> Sign out
				</Button>
				<Button variant="ghost" onclick={handleSignOutOthers} disabled={signingOutOthers}>
					{signingOutOthers ? 'Signing out…' : 'Sign out other sessions'}
				</Button>
			</div>
			<Separator />
			<p class="text-xs text-muted-foreground">
				Your session is held in an HTTP-only cookie and renewed as you work — it is never exposed to
				page scripts. <strong class="font-medium text-foreground">Sign out</strong> ends it in this
				browser only. <strong class="font-medium text-foreground">Sign out other sessions</strong>
				revokes every other browser and device signed in to this account.
			</p>
			<p class="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
				<KeyRound class="size-3" /> Need a long-lived credential for an editor or MCP client? Create an
				API key on the <a href="/app/connect" class="underline underline-offset-2">Connect</a> page.
			</p>
		</CardContent>
	</Card>
</div>
