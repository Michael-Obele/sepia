<script lang="ts">
	import { Label } from '$lib/components/ui/label/index.js';
	import { Search, LoaderCircle, ChevronDown, ChevronRight, Check } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Card, CardContent } from '$lib/components/ui/card/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import { getGraph, getFullGraph, getGraphRoot, getEntities } from '$lib/remote/index.js';
	import { importancePct } from '$lib/format.js';
	import { goto } from '$app/navigation';
	import type { GraphResult } from '@sepia/shared';

	import {
		forceManyBody,
		forceLink,
		forceCenter,
		forceCollide,
		type Simulation,
		type SimulationNodeDatum,
		type SimulationLinkDatum
	} from 'd3-force';
	import { curveLinear } from 'd3-shape';
	import { Chart, Link, Layer, Tooltip } from 'layerchart';
	import { ForceSimulation } from 'layerchart/force';
	import { cls } from '@layerstack/tailwind';
	import { clamp, type Prettify } from '@layerstack/utils';

	import { movable } from '$lib/actions/movable';
	import GraphControls from '$lib/components/graph-controls.svelte';

	type GraphNode = { id: string; label: string; type: string; importance: number };
	type GraphEdge = { id: string; source: string; target: string; label: string; weight: number };

	let {
		focus = ''
	}: {
		/** Entity id to centre on (focus mode). Empty = full graph. */
		focus?: string;
	} = $props();

	type SimNode = Prettify<GraphNode & SimulationNodeDatum>;
	// Omit source/target from GraphEdge so the SimulationLinkDatum's
	// `NodeDatum | string | number` union isn't collapsed to `string`.
	type SimLink = Prettify<Omit<GraphEdge, 'source' | 'target'> & SimulationLinkDatum<SimNode>>;

	const typeColors: Record<string, string> = {
		person: '#f43f5e',
		project: '#0ea5e9',
		tool: '#14b8a6',
		concept: '#6366f1',
		repo: '#71717a'
	};

	// Deterministic color for arbitrary/custom entity types so every node in
	// the full graph gets a distinct hue (Obsidian-style).
	const GOLDEN_ANGLE = 137.508;

	function typeHsl(type: string, index: number): string {
		if (type in typeColors) return typeColors[type];
		const hue = (index * GOLDEN_ANGLE) % 360;
		return `hsl(${hue}, 70%, 55%)`;
	}

	// Build a deterministic color map for every type in the current graph.
	const typeColorMap = $derived.by(() => {
		const m = new Map<string, string>();
		allTypes.forEach((t, i) => m.set(t, typeHsl(t, i)));
		return m;
	});

	function nodeColor(type: string): string {
		return typeColorMap.get(type) ?? typeColors[type] ?? 'hsl(0, 0%, 60%)';
	}

	function nodeRadius(n: { importance?: number }): number {
		return 10 + (n.importance ?? 0.5) * 16;
	}

	let mode = $state<'full' | 'focus'>('full');
	let rootId = $state('');
	let depth = $state(2);
	let graphData = $state<GraphResult | null>(null);
	let loading = $state(true);
	let error = $state('');

	let rootSearch = $state('');
	let rootResults = $state<Awaited<ReturnType<typeof getEntities>>>([]);

	let sticky = $state(true);
	let dragging = $state(false);
	let moved = $state(false);
	let hoveredId = $state<string | null>(null);
	/** Hovered EDGE — its relation type is drawn on the line while the pointer is on it. */
	let hoveredEdgeId = $state<string | null>(null);
	let typeFilter = $state<Set<string>>(new Set());
	let legendOpen = $state(false);

	// The live d3 simulation, captured from ForceSimulation's `onStart` so the
	// toolbar can reheat a layout without remounting this component.
	let sim: Simulation<SimNode, SimLink> | undefined;

	/** How many nodes are pinned (fx/fy set) — the toolbar offers to free them. */
	let pinnedCount = $state(0);

	// Pick a default root: the focus prop (→ focus mode), else the
	// most-accessed entity (used if the user switches to focus mode).
	$effect(() => {
		if (focus) {
			mode = 'focus';
			rootId = focus;
		} else if (!rootId) {
			// Centre on the entity with the most RELATIONS, not the most views. A
			// frequently-opened entity may have no edges at all, and traversing from
			// it yields a single node (which is what made Focus look broken).
			getGraphRoot().then((root) => {
				if (root) rootId = root.id;
			});
		}
	});

	async function loadGraph() {
		loading = true;
		error = '';
		try {
			if (mode === 'full') {
				graphData = await getFullGraph();
			} else {
				if (!rootId) return;
				graphData = await getGraph({ start_id: rootId, depth });
			}
		} catch (e) {
			error = (e as Error)?.message ?? 'Failed to load graph';
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (mode === 'full') {
			loadGraph();
		} else if (rootId) {
			loadGraph();
		}
	});

	// Fresh copies so the force simulation can mutate them (x/y/vx/vy) freely.
	const simNodes = $derived<SimNode[]>(graphData?.nodes.map((n) => ({ ...n })) ?? []);
	const simLinks = $derived<SimLink[]>(graphData?.edges.map((e) => ({ ...e })) ?? []);

	// Distinct entity types present in the loaded graph (for the type filter).
	const allTypes = $derived([...new Set(simNodes.map((n) => n.type))].sort());

	// Node id → type lookup so edge filtering can resolve string endpoints.
	const nodeTypeById = $derived.by(() => {
		const m = new Map<string, string>();
		for (const n of simNodes) m.set(n.id, n.type);
		return m;
	});

	// Node id → importance, so an edge can trim itself to the radius of the node it
	// points at (nodeRadius is a function of importance).
	const nodeImportance = $derived.by(() => {
		const m = new Map<string, number>();
		for (const n of simNodes) m.set(n.id, n.importance);
		return m;
	});

	// Type filter: empty set = show everything.
	const activeTypes = $derived(typeFilter.size === 0 ? null : typeFilter);

	const visibleNodes = $derived(
		activeTypes ? simNodes.filter((n) => activeTypes.has(n.type)) : simNodes
	);

	const visibleLinks = $derived(
		activeTypes
			? simLinks.filter((l) => {
					const src = typeof l.source === 'object' ? l.source.id : String(l.source);
					const tgt = typeof l.target === 'object' ? l.target.id : String(l.target);
					return (
						activeTypes.has(nodeTypeById.get(src) ?? '') &&
						activeTypes.has(nodeTypeById.get(tgt) ?? '')
					);
				})
			: simLinks
	);

	const linkForce = $derived(
		forceLink<SimNode, SimLink>(visibleLinks)
			.id((d) => d.id)
			.distance(90)
			.strength(0.4)
	);
	const chargeForce = forceManyBody<SimNode>().strength(-260);
	const collideForce = forceCollide<SimNode>().radius((d) => nodeRadius(d) + 4);
	const centerForce = forceCenter<SimNode>();

	// Stable object references — ForceSimulation's `watch.pre` on `data` and
	// `forces` only fires when the actual contents change, not on every render.
	// Without this, the simulation restarts on every tick and never settles.
	const simData = $derived({ nodes: visibleNodes, links: visibleLinks });

	let chartSize = $state({ width: 0, height: 0 });
	const onResize = (e: { width: number; height: number }) => {
		chartSize = { width: e.width, height: e.height };
	};

	const simForces = $derived({
		link: linkForce,
		charge: chargeForce,
		collide: collideForce,
		center: centerForce.x(chartSize.width / 2).y(chartSize.height / 2)
	});

	// Neighbours of the hovered node (from the original edges, which keep
	// string source/target ids).
	const neighborIds = $derived.by(() => {
		if (!hoveredId || !graphData) return new Set<string>();
		const set = new Set<string>([hoveredId]);
		for (const e of graphData.edges) {
			if (e.source === hoveredId) set.add(e.target);
			if (e.target === hoveredId) set.add(e.source);
		}
		return set;
	});

	function countPins() {
		pinnedCount = simNodes.filter((n) => n.fx != null).length;
	}

	/**
	 * Pin or release ONE node. `sticky` decides what a drag leaves behind; this
	 * is the way back out of a pin a previous drag created.
	 */
	function setPinned(node: SimNode, pinned: boolean) {
		if (pinned) {
			node.fx = node.x;
			node.fy = node.y;
		} else {
			delete node.fx;
			delete node.fy;
		}
		countPins();
	}

	/** Release every pinned node and reheat, so the layout can breathe again. */
	function releasePins() {
		for (const n of simNodes) {
			delete n.fx;
			delete n.fy;
		}
		pinnedCount = 0;
		sim?.alpha(1).restart();
	}

	function setSticky(next: boolean | 'indeterminate') {
		sticky = next === true;
		// Turning the mode OFF must free what it pinned. The `onMoveEnd` guard only
		// ever affected FUTURE drags, so without this a node pinned while sticky was
		// on stayed fixed for the life of the page with no way to release it.
		if (!sticky) releasePins();
	}

	/**
	 * Label policy. Every name is drawn while the graph is small enough to read;
	 * past that, labels follow the pointer instead of piling into a mat of text.
	 */
	const LABEL_LIMIT = 60;
	const labelAll = $derived(visibleNodes.length <= LABEL_LIMIT);
	function showLabel(id: string): boolean {
		return hoveredId === null ? labelAll : neighborIds.has(id);
	}

	function toggleType(type: string) {
		const next = new Set(typeFilter);
		if (next.has(type)) {
			next.delete(type);
		} else {
			next.add(type);
		}
		typeFilter = next;
	}

	async function searchRoots() {
		if (!rootSearch.trim()) {
			rootResults = [];
			return;
		}
		rootResults = await getEntities({ q: rootSearch, limit: 8 });
	}

	function pickRoot(id: string, name: string) {
		// Only set `rootId` — the `$effect` above owns loading. Calling
		// `loadGraph()` here as well fired two identical traversals per pick.
		rootId = id;
		rootSearch = name;
		rootResults = [];
	}
</script>

<!--
	The force-directed view of the knowledge graph, mounted as a panel by
	/app/entities. The graph is a RENDERING of the same nodes the list shows,
	not its own dataset, so it carries no heading and no title of its own — the
	entities route owns those.
-->
<div class="space-y-4">
	<Card>
		<CardContent class="flex flex-wrap items-end gap-3 p-4">
			<div class="space-y-1">
				<span class="text-xs text-muted-foreground">View</span>
				<div class="flex overflow-hidden rounded-md border">
					<button
						type="button"
						onclick={() => (mode = 'full')}
						class={cls(
							'px-3 py-1.5 text-sm transition-colors',
							mode === 'full'
								? 'bg-primary text-primary-foreground'
								: 'bg-background text-muted-foreground hover:bg-accent'
						)}
					>
						Full graph
					</button>
					<button
						type="button"
						onclick={() => (mode = 'focus')}
						class={cls(
							'px-3 py-1.5 text-sm transition-colors',
							mode === 'focus'
								? 'bg-primary text-primary-foreground'
								: 'bg-background text-muted-foreground hover:bg-accent'
						)}
					>
						Focus
					</button>
				</div>
			</div>

			{#if mode === 'focus'}
				<div class="space-y-1">
					<label for="root-search" class="text-xs text-muted-foreground">Root entity</label>
					<div class="relative">
						<Search class="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
						<Input
							id="root-search"
							bind:value={rootSearch}
							placeholder="Search root entity…"
							class="w-56 pl-9"
							onkeydown={(e) => {
								if (e.key === 'Enter') {
									e.preventDefault();
									searchRoots();
								}
							}}
						/>
					</div>
					{#if rootResults.length > 0}
						<div
							class="absolute z-10 mt-1 max-h-40 w-56 space-y-1 overflow-y-auto rounded-md border bg-background p-1 shadow-md"
						>
							{#each rootResults as r (r.id)}
								<button
									type="button"
									onclick={() => pickRoot(String(r.id), r.name)}
									class="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
								>
									<span class="truncate">{r.name}</span>
									<Badge variant="outline">{r.type}</Badge>
								</button>
							{/each}
						</div>
					{/if}
				</div>
				<div class="space-y-1">
					<label for="depth-slider" class="text-xs text-muted-foreground">Depth: {depth}</label>
					<input
						id="depth-slider"
						type="range"
						bind:value={depth}
						min={1}
						max={3}
						step={1}
						class="w-32"
						onchange={loadGraph}
						aria-label="Traversal depth"
					/>
				</div>
				<Button onclick={loadGraph} disabled={loading}>
					{#if loading}<LoaderCircle class="size-4 animate-spin" />{/if}
					Traverse
				</Button>
			{/if}

			{#if mode === 'full' && allTypes.length > 0}
				<div class="space-y-1">
					<span class="text-xs text-muted-foreground">Filter by entity type</span>
					<DropdownMenu.Root>
						<DropdownMenu.Trigger>
							<Button variant="outline" class="gap-2">
								{typeFilter.size === 0
									? 'All types'
									: typeFilter.size === 1
										? '1 type'
										: `${typeFilter.size} types`}
								<ChevronDown class="size-4" />
							</Button>
						</DropdownMenu.Trigger>
						<DropdownMenu.Content
							align="start"
							class="max-h-80 w-auto max-w-[min(92vw,22rem)] min-w-(--bits-dropdown-menu-anchor-width)"
						>
							<DropdownMenu.Item onclick={() => (typeFilter = new Set())} class="whitespace-nowrap">
								{#if typeFilter.size === 0}
									<Check class="size-4 shrink-0" />
								{:else}
									<span class="size-4 shrink-0"></span>
								{/if}
								<span class="truncate">All types</span>
							</DropdownMenu.Item>
							<DropdownMenu.Separator />
							{#each allTypes as type (type)}
								<DropdownMenu.Item onclick={() => toggleType(type)} class="whitespace-nowrap">
									{#if typeFilter.has(type)}
										<Check class="size-4 shrink-0" />
									{:else}
										<span class="size-4 shrink-0"></span>
									{/if}
									<span class="min-w-0 flex-1 truncate" title={type}>{type}</span>
								</DropdownMenu.Item>
							{/each}
						</DropdownMenu.Content>
					</DropdownMenu.Root>
				</div>
			{/if}

			<Label for="sticky-nodes" class="flex items-center gap-2 pb-2 text-sm text-muted-foreground">
				<Checkbox id="sticky-nodes" checked={sticky} onCheckedChange={setSticky} />
				Sticky nodes
			</Label>
		</CardContent>
	</Card>

	{#if error}
		<p class="text-sm text-destructive">{error}</p>
	{/if}

	<!--
		An isolated entity is a legitimate answer, not a failure — 58% of entities
		have no relations. Say so, and offer the way out, instead of rendering one
		lonely dot that reads as a broken page.
	-->
	{#if mode === 'focus' && graphData && !loading && graphData.edges.length === 0}
		<p class="text-sm text-muted-foreground">
			<strong class="font-medium text-foreground">{graphData.nodes[0]?.label}</strong> has no
			relations yet, so there is nothing to traverse from it. Add one from its entity page, or
			<button type="button" onclick={() => (mode = 'full')} class="underline underline-offset-2">
				view the full graph
			</button>.
		</p>
	{/if}

	<Card>
		<CardContent class="p-0">
			{#if loading}
				<Skeleton class="min-h-100 w-full rounded-none" />
			{:else if graphData && visibleNodes.length > 0}
				<div class="relative">
					<Chart
						transform={{
							mode: 'canvas',
							scrollMode: 'scale',
							scaleExtent: [0.2, 4],
							motion: { type: 'tween', duration: 300 }
						}}
						clip
						height={640}
						class="max-h-[80vh] min-h-100"
						{onResize}
					>
						{#snippet children({ context })}
							<Layer>
								<!--
									The arrowhead every edge points with. Relations are DIRECTED
									(`addRelation` takes direction: out | in; types are `uses`, `prefers`),
									so without this `A —uses→ B` and `B —uses→ A` look identical.
								-->
								<defs>
									<marker
										id="edge-arrow"
										viewBox="0 0 10 10"
										refX="8"
										refY="5"
										markerWidth="4"
										markerHeight="4"
										orient="auto-start-reverse"
									>
										<path d="M 0 0 L 10 5 L 0 10 z" class="fill-muted-foreground/60" />
									</marker>
								</defs>
								<ForceSimulation
									forces={simForces}
									data={simData}
									onStart={(e) => (sim = e.simulation)}
								>
									{#snippet children({ nodes, simulation, linkPositions })}
										{#each visibleLinks as link, i (link.id)}
											{@const pos = linkPositions[i]}
											{@const src = typeof link.source === 'object' ? link.source.id : link.source}
											{@const tgt = typeof link.target === 'object' ? link.target.id : link.target}
											{@const connected =
												hoveredId === null || src === hoveredId || tgt === hoveredId}
											{@const edgeHovered = hoveredEdgeId === link.id}
											<!--
								An edge is drawn source→target, so `marker-end` puts the arrowhead at
								the TARGET. The line is trimmed by the target's radius first: drawn to
								the centre, the arrowhead would sit under the node circle and never be
								seen. Stroke weight carries `weight`, which was fetched and discarded.
							-->
											{@const dx = pos.x2 - pos.x1}
											{@const dy = pos.y2 - pos.y1}
											{@const len = Math.hypot(dx, dy) || 1}
											{@const trim =
												nodeRadius({ importance: nodeImportance.get(String(tgt)) }) + 6}
											<Link
												data={link}
												x1={pos.x1}
												y1={pos.y1}
												x2={pos.x2 - (dx / len) * trim}
												y2={pos.y2 - (dy / len) * trim}
												curve={curveLinear}
												stroke-width={0.8 + link.weight * 1.6}
												marker-end="url(#edge-arrow)"
												onpointerenter={() => (hoveredEdgeId = link.id)}
												onpointerleave={() => (hoveredEdgeId = null)}
												class={cls(
													'cursor-pointer transition-opacity',
													edgeHovered ? 'stroke-primary' : 'stroke-muted-foreground/30',
													hoveredId !== null && !connected && 'opacity-15'
												)}
											/>
											{#if edgeHovered}
												<text
													x={(pos.x1 + pos.x2) / 2}
													y={(pos.y1 + pos.y2) / 2 - 5}
													text-anchor="middle"
													class="pointer-events-none fill-foreground text-[10px]"
												>
													{link.label}
												</text>
											{/if}
										{/each}
										{#each nodes as node, i (node.id)}
											{@const thisNode = simulation.nodes()[i]}
											{@const dimmed = hoveredId !== null && !neighborIds.has(node.id)}
											<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
											<circle
												cx={node.x}
												cy={node.y}
												r={nodeRadius(node)}
												use:movable={{
													onMoveStart: () => {
														context.tooltip.hide();
														dragging = true;
														moved = false;
													},
													onMove: (e) => {
														moved = true;
														thisNode.fx = clamp(
															(thisNode.fx ?? thisNode.x ?? 0) + e.detail.dx,
															0,
															context.width
														);
														thisNode.fy = clamp(
															(thisNode.fy ?? thisNode.y ?? 0) + e.detail.dy,
															0,
															context.height
														);
														simulation.alpha(1).restart();
													},
													onMoveEnd: () => {
														dragging = false;
														if (!sticky) {
															delete thisNode.fx;
															delete thisNode.fy;
															simulation.alpha(1).restart();
														}
														countPins();
													}
												}}
												onclick={(e) => {
													if (moved) return;
													// A pinned node is the surprising state, so clicking one FREES it —
													// before this the only way out of a pin was a page reload.
													// Shift-click pins; a free node opens.
													if (thisNode.fx != null) {
														setPinned(thisNode, false);
														simulation.alpha(1).restart();
													} else if (e.shiftKey) {
														setPinned(thisNode, true);
													} else {
														goto(`/app/entities/${node.id}`);
													}
												}}
												onpointerenter={() => (hoveredId = node.id)}
												onpointerleave={() => {
													hoveredId = null;
													context.tooltip.hide();
												}}
												onpointermove={(e) => !dragging && context.tooltip.show(e, node)}
												class={cls(
													'cursor-grab transition-opacity select-none',
													dimmed && 'opacity-20'
												)}
												fill={nodeColor(node.type)}
												stroke="var(--color-background)"
												stroke-width={2}
											/>
											{#if showLabel(node.id)}
												<text
													x={node.x}
													y={(node.y ?? 0) + nodeRadius(node) + 12}
													text-anchor="middle"
													class={cls(
														'pointer-events-none fill-muted-foreground/80 text-[10px] transition-opacity select-none',
														dimmed && 'opacity-20'
													)}
												>
													{node.label}
												</text>
											{/if}
										{/each}
									{/snippet}
								</ForceSimulation>
							</Layer>

							<GraphControls />

							<Tooltip.Root>
								{#snippet children({ data })}
									<Tooltip.Header>{data.label}</Tooltip.Header>
									<Tooltip.List>
										<Tooltip.Item label="Type" value={data.type} />
										<Tooltip.Item
											label="Importance"
											value={importancePct(data.importance)}
											format="integer"
										/>
									</Tooltip.List>
								{/snippet}
							</Tooltip.Root>
						{/snippet}
					</Chart>
				</div>
			{:else}
				<div class="flex min-h-100 items-center justify-center text-sm text-muted-foreground">
					{#if mode === 'full'}
						No entities match the selected types.
					{:else}
						Pick a root entity to explore the graph.
					{/if}
				</div>
			{/if}
		</CardContent>
	</Card>

	{#if graphData && visibleNodes.length > 0}
		<Card>
			<CardContent class="flex flex-wrap items-center gap-3 p-3">
				<!-- Stats badges -->
				<div class="flex flex-wrap items-center gap-1.5">
					<Badge variant="secondary" class="font-mono tabular-nums">
						{visibleNodes.length} nodes
					</Badge>
					<Badge variant="secondary" class="font-mono tabular-nums">
						{visibleLinks.length} edges
					</Badge>
					{#if mode === 'focus'}
						<Badge variant="outline" class="text-muted-foreground">
							depth {graphData.depth_reached}
						</Badge>
					{/if}
				</div>

				<!-- Type legend -->
				{#if allTypes.length > 0}
					<div class="flex items-center gap-2">
						{#if allTypes.length > 5}
							<button
								type="button"
								onclick={() => (legendOpen = !legendOpen)}
								class="flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
							>
								{#if legendOpen}
									<ChevronDown class="size-3" />
								{:else}
									<ChevronRight class="size-3" />
								{/if}
								<span class="font-medium">{allTypes.length} types</span>
							</button>
						{/if}
						{#if legendOpen || allTypes.length <= 5}
							<div class="flex flex-wrap gap-1.5">
								{#each allTypes as type (type)}
									<button
										type="button"
										onclick={() => toggleType(type)}
										class="flex items-center gap-1.5 rounded-md border px-2 py-0.5 transition-colors hover:bg-accent {typeFilter.size >
											0 && !typeFilter.has(type)
											? 'opacity-40'
											: ''}"
									>
										<span class="size-2 shrink-0 rounded-full" style:background={nodeColor(type)}
										></span>
										<span class="whitespace-nowrap">{type}</span>
									</button>
								{/each}
							</div>
						{/if}
					</div>
				{/if}
			</CardContent>
		</Card>
	{/if}
</div>
