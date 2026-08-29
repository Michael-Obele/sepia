<script lang="ts">
	import { Sparkles } from '@lucide/svelte';
	import { Badge } from '$lib/components/ui/badge/index.js';

	type Turn = { from: 'user' | 'agent'; text: string; memory?: string };

	// A short, realistic exchange — the product's core promise, demonstrated.
	const turns: Turn[] = [
		{
			from: 'user',
			text: 'What theme does Michael prefer?'
		},
		{
			from: 'agent',
			text: 'Michael prefers dark mode — saved as a preference memory (importance 0.7).',
			memory: 'preference · importance 0.7'
		},
		{
			from: 'user',
			text: 'And what stack is the sepia project on?'
		},
		{
			from: 'agent',
			text: 'Svelte, Bun, Postgres, SvelteKit — from the sepia project graph.',
			memory: 'project graph · 4 relations'
		},
		{
			from: 'user',
			text: 'Remind me how auth works here.'
		},
		{
			from: 'agent',
			text: 'Two-phase: Bearer token for local editors, OAuth 2.1 + PKCE for web AIs. No reminder needed — it was in memory.',
			memory: 'concept · recalled automatically'
		}
	];
</script>

<div class="rounded-xl border border-border/50 bg-card/40 p-4">
	<div class="mb-3 flex items-center justify-between">
		<div class="flex items-center gap-2 text-xs font-medium text-muted-foreground">
			<span class="relative flex size-1.5">
				<span
					class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60"
				></span>
				<span class="relative inline-flex size-1.5 rounded-full bg-emerald-400"></span>
			</span>
			Live recall — no reminders
		</div>
		<Badge variant="outline" class="font-mono text-[10px]">sepia · search</Badge>
	</div>

	<div class="space-y-3">
		{#each turns as t, i (i)}
			<div class="flex {t.from === 'user' ? 'justify-end' : 'justify-start'}">
				<div
					class="max-w-[85%] rounded-lg px-3 py-2 {t.from === 'user'
						? 'bg-primary/10 ring-1 ring-primary/20'
						: 'bg-muted/60'}"
				>
					<p class="text-sm leading-relaxed text-foreground">{t.text}</p>
					{#if t.memory}
						<p class="mt-1.5 flex items-center gap-1 text-[10px] font-medium text-emerald-400">
							<Sparkles class="size-3" />
							{t.memory}
						</p>
					{/if}
				</div>
			</div>
		{/each}
	</div>
</div>
