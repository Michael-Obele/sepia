<script lang="ts">
	import * as Avatar from '$lib/components/ui/avatar/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Download, Share2, Sparkles, Copy } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { avatarUrl, avatarPngBlob, initials, type AvatarSource } from '$lib/avatar';

	let {
		user,
		plan = 'free'
	}: {
		/** The signed-in user — name seeds the face, `image` overrides it. */
		user: AvatarSource | null | undefined;
		/** Free/Pro — only changes the badge on the card. */
		plan?: string;
	} = $props();

	/** Big, square, tweet-ready. */
	const EXPORT = 1024;
	const shareUrl = $derived(
		typeof location !== 'undefined' ? `${location.origin}/` : 'https://sepia.fly.dev/'
	);

	let busy = $state(false);

	/** Rasterise the vector avatar — the PNG endpoint would cap us at 256px. */
	async function toBlob(): Promise<Blob> {
		return avatarPngBlob(user, EXPORT);
	}

	/** Save the face to disk — the low-tech share path that always works. */
	async function download() {
		if (busy) return;
		busy = true;
		try {
			const blob = await toBlob();
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `sepia-${(user?.name ?? 'avatar').trim().toLowerCase().replace(/\s+/g, '-') || 'avatar'}.png`;
			a.click();
			URL.revokeObjectURL(url);
			toast.success('Avatar saved');
		} catch (e) {
			toast.error((e as Error).message ?? 'Download failed');
		} finally {
			busy = false;
		}
	}

	/**
	 * Native share sheet (mobile) with the PNG attached; desktop browsers
	 * without file sharing fall back to copying the site link.
	 */
	async function share() {
		if (busy) return;
		busy = true;
		try {
			const blob = await toBlob();
			const file = new File([blob], 'sepia-avatar.png', { type: 'image/png' });
			const data = {
				title: 'My Sepia avatar',
				text: `My Sepia face — generated from my name at ${shareUrl}`,
				url: shareUrl,
				files: [file]
			};
			if (navigator.canShare?.({ files: [file] })) {
				await navigator.share(data);
			} else {
				await navigator.clipboard.writeText(shareUrl);
				toast.success('Link copied — sharing files isn’t supported here');
			}
		} catch (e) {
			// AbortError = the user closed the sheet. Not an error worth toasting.
			if ((e as Error).name !== 'AbortError') {
				toast.error((e as Error).message ?? 'Share failed');
			}
		} finally {
			busy = false;
		}
	}

	async function copyLink() {
		await navigator.clipboard.writeText(shareUrl);
		toast.success('Link copied');
	}
</script>

<!--
	The "meet your face" card: a big generated portrait plus the two verbs
	that make it shareable (save / send). Deliberately oversized — this is
	the moment a new user sees their identity on Sepia for the first time.
-->
<div
	class="flex flex-col items-center gap-5 rounded-2xl border bg-linear-to-b from-muted/50 to-transparent p-8 text-center"
>
	<div class="relative">
		<!-- Decorative ring + offset accent so the portrait reads as a "sticker" -->
		<div
			class="absolute -inset-2 rounded-full bg-linear-to-tr from-primary/30 via-accent/20 to-transparent blur-md"
			aria-hidden="true"
		></div>
		<Avatar.Root
			class="relative size-36 border-4 border-background shadow-xl sm:size-44"
			delayMs={200}
		>
			<Avatar.Image
				src={avatarUrl(user, 512)}
				alt={user?.name ? `${user.name}'s avatar` : 'Your avatar'}
				class="object-cover"
			/>
			<!-- text-foreground clears AAA (7:1) in both themes; see user-avatar.svelte. -->
			<Avatar.Fallback class="text-4xl font-semibold text-foreground"
				>{initials(user)}</Avatar.Fallback
			>
		</Avatar.Root>
		{#if plan === 'pro'}
			<Badge class="absolute -right-1 -bottom-1 gap-1 bg-primary text-primary-foreground shadow-md">
				<Sparkles class="size-3" /> Pro
			</Badge>
		{/if}
	</div>

	<div class="space-y-1">
		<p class="text-xl font-semibold tracking-tight">{user?.name ?? 'You'}</p>
		<p class="text-sm text-muted-foreground">
			Fixed face, generated from your name. Same you, everywhere.
		</p>
	</div>

	<div class="flex flex-wrap justify-center gap-2">
		<Button onclick={download} disabled={busy} class="gap-1.5">
			<Download class="size-4" /> Download PNG
		</Button>
		<Button variant="outline" onclick={share} disabled={busy} class="gap-1.5">
			<Share2 class="size-4" /> Share
		</Button>
		<Button variant="ghost" size="icon" onclick={copyLink} aria-label="Copy link to Sepia">
			<Copy class="size-4" />
		</Button>
	</div>
</div>
