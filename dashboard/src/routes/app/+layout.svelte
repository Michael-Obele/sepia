<script lang="ts">
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import AppSidebar from '$lib/components/app-sidebar.svelte';
	import { isAuthed } from '$lib/auth.svelte';
	import SignIn from '$lib/components/sign-in.svelte';

	let { children } = $props();
</script>

<svelte:head>
	<title>Sepia — Memory Server</title>
	<meta name="description" content="Browse, search, and manage your AI memory knowledge graph." />
</svelte:head>

{#if isAuthed()}
	<Sidebar.Provider class="overflow-x-hidden">
		<AppSidebar />
		<main class="flex min-h-svh min-w-0 flex-1 flex-col overflow-x-hidden">
			<Sidebar.Trigger class="mt-2 ml-2 shrink-0" />
			<div class="min-w-0 flex-1 overflow-hidden p-4 md:p-6 lg:p-8">
				{@render children()}
			</div>
		</main>
	</Sidebar.Provider>
{:else}
	<SignIn />
{/if}
