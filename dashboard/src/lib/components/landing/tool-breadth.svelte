<script lang="ts">
	import { BarChart, defaultChartPadding } from 'layerchart';

	// Honest operation counts per MCP tool, straight from src/tools/*.ts.
	// manage_memory gained `ingest` (conversation handoff) — 7 actions now.
	const data = [
		{ tool: 'manage_memory', ops: 7 },
		{ tool: 'manage_entity', ops: 6 },
		{ tool: 'manage_namespace', ops: 4 },
		{ tool: 'manage_relation', ops: 3 },
		{ tool: 'consolidate', ops: 1 },
		{ tool: 'search', ops: 1 },
		{ tool: 'traverse_graph', ops: 1 }
	];
</script>

<BarChart
	{data}
	x="ops"
	y="tool"
	orientation="horizontal"
	series={[{ key: 'ops', value: 'ops', color: 'var(--color-brand)' }]}
	axis="y"
	rule={false}
	props={{
		yAxis: {
			tickLabelProps: {
				textAnchor: 'start',
				dx: 6,
				dy: 2,
				class: 'text-xs fill-black stroke-none'
			},
			tickLength: 0
		},
		xAxis: {
			ticks: [0, 2, 4, 6],
			format: (d) => ''
		}
	}}
	padding={defaultChartPadding({ left: 0, bottom: 16 })}
	height={300}
/>
