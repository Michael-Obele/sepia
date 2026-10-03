<script lang="ts">
	import EntityGraph from '$lib/components/entity-graph.svelte';
	import SectionTabs from '$lib/components/section-tabs.svelte';
	import { entityTabs } from '$lib/section-tabs.js';
	import { graphSearchSchema, SEARCH_PARAMS_OPTIONS } from '$lib/search-params.js';
	import { useSearchParams } from 'runed/kit';

	// `focus` is the entity the graph should centre on. It lives on THIS route,
	// so an entity detail page can link to `/app/graph?focus=<id>` and the id
	// arrives intact.
	const params = useSearchParams(graphSearchSchema, SEARCH_PARAMS_OPTIONS);
</script>

<svelte:head><title>Sepia — Graph</title></svelte:head>

<div class="space-y-6">
	<!--
		No flex row here: this is the section heading, not a header bar. The
		entities LIST page wraps the same heading in `flex justify-between` because
		it also holds the "New entity" button — copying that wrapper here left a
		justify-between with a single child, which justifies nothing.
	-->
	<div>
		<h1 class="text-2xl font-semibold tracking-tight">Entities</h1>
		<p class="text-sm text-muted-foreground">
			Force-directed view of the same nodes. Drag nodes, scroll to zoom, drag the background to pan.
			Click a node to open it.
		</p>
	</div>

	<SectionTabs items={entityTabs} label="Entity views" />

	<EntityGraph focus={params.focus} />
</div>
