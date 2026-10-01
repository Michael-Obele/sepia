<script lang="ts">
	import * as Avatar from '$lib/components/ui/avatar/index.js';
	import { avatarUrl, initials, type AvatarSource } from '$lib/avatar';

	let {
		user,
		class: className = 'size-8'
	}: {
		/** The user (or `{ name }` — anything with a name/image is enough). */
		user: AvatarSource | null | undefined;
		/** Tailwind size classes; defaults to the stock `size-8`. */
		class?: string;
	} = $props();

	const src = $derived(avatarUrl(user, 128));
	const fallback = $derived(initials(user));
</script>

<!--
	Avatar.Root tracks load status internally: while the DiceBear SVG is in
	flight (or if it 404s) the initials show instead — no empty circle.
	`delayMs` avoids a flash of initials when the CDN answers instantly.
-->
<Avatar.Root class={className} delayMs={200}>
	<Avatar.Image {src} alt={user?.name ? `${user.name}'s avatar` : 'Avatar'} />
	<!-- text-foreground, not the stock muted-foreground: 14.2:1 dark / 16:1 light,
	     so the initials clear AAA (7:1) in either theme. -->
	<Avatar.Fallback class="text-xs font-medium text-foreground">{fallback}</Avatar.Fallback>
</Avatar.Root>
