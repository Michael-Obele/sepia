<script lang="ts">
	import { SlidersHorizontal } from '@lucide/svelte';
	import BriefingPanel from '$lib/components/briefing-panel.svelte';
	import SectionTabs from '$lib/components/section-tabs.svelte';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card/index.js';
	import { getBriefingPage } from '$lib/remote/index.js';
	import { briefingSearchSchema, SEARCH_PARAMS_OPTIONS } from '$lib/search-params.js';
	import { memoryTabs } from '$lib/section-tabs.js';
	import { useSearchParams } from 'runed/kit';
	import { untrack } from 'svelte';

	// The briefing is a SLICE of memories — the standing rules an AI loads at
	// session start — so it shares the namespace filter with the list and
	// nothing else. The text/type/importance filters are list-only.
	const params = useSearchParams(briefingSearchSchema, SEARCH_PARAMS_OPTIONS);

	/** This page's view model: the briefing plus the namespace options. */
	type BriefingPage = Awaited<ReturnType<typeof getBriefingPage>>;

	// The namespace the SSR briefing belongs to. Read ONCE — a later filter change
	// re-runs the PANEL's own load, not this.
	const initialNamespace = untrack(() => params.namespace);

	// AWAITED DURING SSR — see the note in `entities/+page.svelte`. ONE Neon HTTP
	// round trip for the briefing and the namespace options, serialised into the
	// payload, so the browser makes no initial data request.
	const initialPage: BriefingPage = await getBriefingPage({
		namespace: initialNamespace === 'all' ? undefined : initialNamespace
	});

	let view = $state<BriefingPage>(initialPage);

	// Render `view.namespaces` DIRECTLY. Do not wrap it in a promise for an
	// `{#await}` block: a `$derived(Promise.resolve(x))` gives `{#await}` a NEW
	// promise on every re-evaluation, so the block stays in its PENDING branch
	// forever and the page renders nothing. See the note in `app/+page.svelte`.
</script>

<svelte:head><title>Sepia — Briefing</title></svelte:head>

<div class="space-y-6">
	<div>
		<h1 class="text-2xl font-semibold tracking-tight">Memories</h1>
		<p class="text-sm text-muted-foreground">
			The standing rules every AI loads at session start — before any work. Edit them here; your AIs
			edit them too via
			<code class="rounded bg-muted px-1 py-0.5 text-xs">manage_memory</code> — same data.
		</p>
	</div>

	<SectionTabs items={memoryTabs} label="Memory views" />

	<Card>
		<CardHeader class="pb-3">
			<CardTitle class="flex items-center gap-2 text-base">
				<SlidersHorizontal class="size-4" /> Filters
			</CardTitle>
		</CardHeader>
		<CardContent class="flex flex-wrap items-end gap-3">
			<div class="flex min-w-0 flex-col gap-1.5">
				<label for="briefing-ns" class="text-xs font-medium text-muted-foreground">Namespace</label>
				<select
					id="briefing-ns"
					value={params.namespace}
					onchange={(e) => (params.namespace = e.currentTarget.value)}
					class="h-9 w-full min-w-45 shrink-0 rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none sm:w-auto"
					aria-label="Namespace filter"
				>
					<option value="all">All namespaces</option>
					{#each view.namespaces as n (n.name)}
						<option value={n.name}>{n.name}</option>
					{/each}
				</select>
			</div>
		</CardContent>
	</Card>

	<BriefingPanel
		namespace={params.namespace}
		namespaceList={view.namespaces.map((n) => n.name)}
		initial={view.briefing}
		{initialNamespace}
	/>
</div>
