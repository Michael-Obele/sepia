<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg?no-inline';
	import { Toaster } from '$lib/components/ui/sonner/index.js';
	import { Agentation, type AnnotationProps } from 'sv-agentation';
	import { browser, dev } from '$app/environment';

	let playgroundAnnotationProps: AnnotationProps = {
		toolbarPosition: 'bottom-left',
		outputMode: 'forensic',
		pauseAnimations: true,
		clearOnCopy: true,
		includeComponentContext: false,
		includeComputedStyles: false
	};

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" type="image/svg+xml" href={favicon} />
	<meta name="theme-color" content="#D4956A" />
</svelte:head>

{@render children()}

<Toaster />

{#if browser && dev}
	<Agentation {...playgroundAnnotationProps} />
{/if}
