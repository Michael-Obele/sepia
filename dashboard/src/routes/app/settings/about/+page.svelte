<script lang="ts">
	import { ExternalLink, Globe, CreditCard, Code2 } from '@lucide/svelte';
	import * as Card from '$lib/components/ui/card/index.js';
	import { DOCS_VERSION } from '@sepia/shared/types';

	/** Outbound links live in one place so the About page has no duplicated copy. */
	const links = [
		{
			href: 'https://sepia.fly.dev',
			label: 'sepia.fly.dev',
			note: 'Hosted memory server',
			icon: Globe
		},
		{ href: '/pricing', label: 'Pricing', note: 'Free and Pro plans', icon: CreditCard },
		{
			href: 'https://github.com/Michael-Obele/sepia',
			label: 'github.com/Michael-Obele/sepia',
			note: 'Source — self-host free forever',
			icon: Code2
		}
	] as const;

	const isExternal = (href: string) => href.startsWith('http');
</script>

<div class="space-y-6">
	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">About Sepia</Card.Title>
			<Card.Description>
				A memory server for AI agents. One graph every AI reads and writes, over MCP.
			</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-2 text-sm text-muted-foreground">
			<p>
				Self-hosted Sepia is free forever and feature-identical. Hosted is the zero-ops option —
				your escape hatch is always open, and everything you store can be exported as JSON or
				Markdown from
				<a href="/app/settings/data" class="underline underline-offset-2">Data &amp; privacy</a>.
			</p>
			<p class="text-xs">
				Agent-facing contract
				<code class="font-mono text-foreground">v{DOCS_VERSION}</code> — what an AI reads before it starts
				work.
			</p>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Links</Card.Title>
		</Card.Header>
		<Card.Content class="space-y-1">
			{#each links as link (link.href)}
				<a
					href={link.href}
					target={isExternal(link.href) ? '_blank' : undefined}
					rel={isExternal(link.href) ? 'noopener noreferrer' : undefined}
					class="flex items-center gap-3 rounded-md p-2 transition-colors hover:bg-accent"
				>
					<link.icon class="size-4 shrink-0 text-muted-foreground" />
					<span class="min-w-0 flex-1">
						<span class="block truncate text-sm font-medium">{link.label}</span>
						<span class="block truncate text-xs text-muted-foreground">{link.note}</span>
					</span>
					{#if isExternal(link.href)}
						<ExternalLink class="size-3.5 shrink-0 text-muted-foreground" />
					{/if}
				</a>
			{/each}
		</Card.Content>
	</Card.Root>
</div>
