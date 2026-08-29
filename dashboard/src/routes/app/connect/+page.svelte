<script lang="ts">
	import { Copy, Check, Server, KeyRound, ExternalLink, Globe, Sparkles } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Tabs from '$lib/components/ui/tabs/index.js';
	import { auth } from '$lib/auth.svelte';
	import { MEMORY_CONTRACT, MEMORY_CONTRACT_QUICK } from '@sepia/shared';

	const MCP_URL = 'https://sepia.fly.dev/mcp';

	let copied = $state('');
	// Smart default: ChatGPT is pre-selected — the most common web AI.
	let selected = $state('chatgpt');

	async function copy(text: string, key: string) {
		await navigator.clipboard.writeText(text);
		copied = key;
		setTimeout(() => (copied = ''), 1500);
	}

	type Target = {
		id: string;
		name: string;
		auth: 'OAuth' | 'Bearer';
		steps: string[];
		/** Where to paste the memory instructions in this AI's settings. */
		instructionsLocation?: string;
		popular?: boolean;
	};

	const targets: Target[] = [
		{
			id: 'chatgpt',
			name: 'ChatGPT',
			auth: 'OAuth',
			popular: true,
			steps: [
				'Settings → Apps → Developer mode → Create',
				'Choose "Custom app"',
				'Paste the MCP URL',
				'Complete OAuth sign-in'
			],
			instructionsLocation: 'Settings → Custom instructions'
		},
		{
			id: 'claude-web',
			name: 'Claude (web)',
			auth: 'OAuth',
			steps: [
				'Settings → Connectors → Add connector',
				'Choose "Custom"',
				'Paste the MCP URL',
				'Sign in with OAuth'
			],
			instructionsLocation: 'Settings → Custom instructions'
		},
		{
			id: 'grok',
			name: 'Grok (xAI)',
			auth: 'OAuth',
			steps: [
				'grok.com/connectors → New Connector → Custom',
				'Paste the MCP URL',
				'Complete OAuth sign-in'
			],
			instructionsLocation: 'Settings → Memory'
		},
		{
			id: 'perplexity',
			name: 'Perplexity',
			auth: 'OAuth',
			steps: [
				'Settings → Connectors → Custom connector → Remote',
				'Paste the MCP URL',
				'Complete OAuth sign-in'
			],
			instructionsLocation: 'Settings → Custom instructions'
		},
		{
			id: 'lechat',
			name: 'Le Chat',
			auth: 'OAuth',
			steps: ['Connectors → + Add', 'Paste the MCP URL', 'Auto-detect OAuth 2.1'],
			instructionsLocation: 'Settings → Custom instructions'
		},
		{
			id: 'other',
			name: 'Other AI (Gemini, …)',
			auth: 'OAuth',
			steps: [
				'Look for "Connectors", "Apps", or "Custom MCP" in settings',
				'Choose "Custom" / "Remote" and paste the MCP URL',
				'Complete the OAuth sign-in'
			],
			instructionsLocation: 'Look for "Custom instructions" or "Memory" in settings'
		},
		{
			id: 'claude-code',
			name: 'Claude Code',
			auth: 'Bearer',
			steps: ['Add the server to your MCP config', 'Set the Authorization header to your token']
		},
		{
			id: 'cursor',
			name: 'Cursor',
			auth: 'Bearer',
			steps: ['Add a remote MCP server', 'Paste the MCP URL', 'Set the Authorization header']
		},
		{
			id: 'zed',
			name: 'Zed',
			auth: 'Bearer',
			steps: ['Add a remote MCP server', 'Paste the MCP URL', 'Set the Authorization header']
		}
	];

	const current = $derived(targets.find((t) => t.id === selected) ?? targets[0]);

	const bearerConfig = `{
  "mcpServers": {
    "sepia": {
      "type": "http",
      "url": "${MCP_URL}",
      "headers": {
        "Authorization": "Bearer ${auth.token}"
      }
    }
  }
}`;
</script>

<svelte:head><title>Sepia — Connect an AI</title></svelte:head>

<div class="space-y-6">
	<div>
		<h1 class="text-2xl font-semibold tracking-tight">Connect an AI</h1>
		<p class="text-sm text-muted-foreground">
			Point any MCP-capable AI at your memory server. The server URL is <code
				class="rounded bg-muted px-1">{MCP_URL}</code
			>.
		</p>
	</div>

	<!-- Goal gradient: step 1 pre-completed, ChatGPT pre-selected -->
	<Card>
		<CardContent class="p-4">
			<div class="flex flex-wrap items-center gap-2 sm:gap-3">
				{#each ['Pick your AI', 'Copy the URL', 'Authorize', 'Add instructions'] as step, i (step)}
					<div class="flex items-center gap-2 sm:gap-3">
						<div class="flex items-center gap-2">
							<div
								class="flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium {i ===
								0
									? 'bg-primary text-primary-foreground'
									: 'bg-muted text-muted-foreground'}"
							>
								{#if i === 0}<Check class="size-3.5" />{:else}{i + 1}{/if}
							</div>
							<span
								class="text-xs {i === 0 ? 'font-medium text-foreground' : 'text-muted-foreground'}"
								>{step}</span
							>
						</div>
						{#if i < 3}<div class="h-px w-4 bg-border sm:w-8"></div>{/if}
					</div>
				{/each}
			</div>
			<p class="mt-3 text-xs text-muted-foreground">
				Step 1 of 4 — <span class="font-medium text-foreground">{current.name}</span> is pre-selected.
				Pick a different AI below if you use one.
			</p>
		</CardContent>
	</Card>

	<!-- Step 1: pick your AI -->
	<Card>
		<CardHeader>
			<CardTitle class="flex items-center gap-2 text-base">
				<Globe class="size-4" /> 1. Pick your AI
			</CardTitle>
			<CardDescription
				>Web AIs use OAuth 2.1 — paste the URL and sign in with your dashboard password. Local
				editors use the Bearer token.</CardDescription
			>
		</CardHeader>
		<CardContent>
			<div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
				{#each targets as t (t.id)}
					<button
						type="button"
						onclick={() => (selected = t.id)}
						class="flex items-center justify-between gap-2 rounded-lg border px-4 py-3 text-left text-sm transition-colors {selected ===
						t.id
							? 'border-primary bg-primary/5 ring-1 ring-primary/30'
							: 'border-border/60 bg-card/40 hover:border-border hover:bg-card'}"
					>
						<span
							class="font-medium {selected === t.id ? 'text-foreground' : 'text-muted-foreground'}"
							>{t.name}</span
						>
						<span class="flex shrink-0 items-center gap-1.5">
							{#if t.popular}
								<Badge class="bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/15"
									>Most popular</Badge
								>
							{/if}
							<Badge variant={t.auth === 'OAuth' ? 'secondary' : 'outline'}>{t.auth}</Badge>
						</span>
					</button>
				{/each}
			</div>
		</CardContent>
	</Card>

	<!-- Step 2: personalized setup -->
	<Card>
		<CardHeader>
			<CardTitle class="flex items-center gap-2 text-base">
				<Server class="size-4" /> 2. Your setup — {current.name}
			</CardTitle>
			<CardDescription>
				{#if current.auth === 'OAuth'}
					Paste the URL into your AI, then authorize with your dashboard password.
				{:else}
					Add this config to your MCP settings, then set the Authorization header.
				{/if}
			</CardDescription>
		</CardHeader>
		<CardContent class="space-y-4">
			{#if current.auth === 'OAuth'}
				<div class="flex items-center gap-2">
					<code class="flex-1 truncate rounded-md bg-muted px-3 py-2 text-sm">{MCP_URL}</code>
					<Button variant="outline" size="sm" onclick={() => copy(MCP_URL, 'url')} class="gap-1">
						{#if copied === 'url'}<Check class="size-4" />{:else}<Copy class="size-4" />{/if}
						Copy URL
					</Button>
				</div>
				<ol class="space-y-2">
					{#each current.steps as step, i (i)}
						<li class="flex items-start gap-3 text-sm text-muted-foreground">
							<span
								class="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted/60 font-mono text-[11px] text-foreground"
							>
								{i + 1}
							</span>
							<span class="leading-relaxed">{step}</span>
						</li>
					{/each}
				</ol>
			{:else}
				<pre class="overflow-x-auto rounded-md bg-muted p-4 text-xs leading-relaxed"><code
						>{bearerConfig}</code
					></pre>
				<div class="flex flex-wrap items-center gap-2">
					<Button
						variant="outline"
						size="sm"
						onclick={() => copy(bearerConfig, 'config')}
						class="gap-1"
					>
						{#if copied === 'config'}<Check class="size-4" />{:else}<Copy class="size-4" />{/if}
						Copy config
					</Button>
					<p class="text-xs text-muted-foreground">
						Cursor and Zed use slightly different config keys — see the
						<a href="/#install" class="underline underline-offset-4 hover:text-foreground">
							install guide
						</a>
						for per-editor snippets.
					</p>
				</div>
			{/if}
		</CardContent>
	</Card>

	<!-- Step 3: memory instructions (web AIs may not read the MCP instructions field) -->
	{#if current.auth === 'OAuth'}
		<Card>
			<CardHeader>
				<CardTitle class="flex items-center gap-2 text-base">
					<Sparkles class="size-4" /> 3. Add the memory instructions
				</CardTitle>
				<CardDescription>
					Web AIs don't always read the MCP server's built-in instructions. Paste this into
					{current.name}'s custom instructions so it remembers to search and save to your memory.
				</CardDescription>
			</CardHeader>
			<CardContent class="space-y-4">
				<Tabs.Root value="quick">
					<Tabs.List>
						<Tabs.Trigger value="quick">Quick start</Tabs.Trigger>
						<Tabs.Trigger value="full">Full contract</Tabs.Trigger>
					</Tabs.List>
					<Tabs.Content value="quick" class="space-y-3">
						<pre
							class="max-h-64 overflow-y-auto rounded-md bg-muted p-4 text-xs leading-relaxed whitespace-pre-wrap"><code
								>{MEMORY_CONTRACT_QUICK}</code
							></pre>
						<Button
							variant="outline"
							size="sm"
							onclick={() => copy(MEMORY_CONTRACT_QUICK, 'quick')}
							class="gap-1"
						>
							{#if copied === 'quick'}<Check class="size-4" />{:else}<Copy class="size-4" />{/if}
							Copy quick instructions
						</Button>
					</Tabs.Content>
					<Tabs.Content value="full" class="space-y-3">
						<pre
							class="max-h-64 overflow-y-auto rounded-md bg-muted p-4 text-xs leading-relaxed whitespace-pre-wrap"><code
								>{MEMORY_CONTRACT}</code
							></pre>
						<Button
							variant="outline"
							size="sm"
							onclick={() => copy(MEMORY_CONTRACT, 'full')}
							class="gap-1"
						>
							{#if copied === 'full'}<Check class="size-4" />{:else}<Copy class="size-4" />{/if}
							Copy full contract
						</Button>
					</Tabs.Content>
				</Tabs.Root>
				{#if current.instructionsLocation}
					<div
						class="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground"
					>
						<ExternalLink class="mt-0.5 size-3.5 shrink-0" />
						<span>
							Paste it in <span class="font-medium text-foreground"
								>{current.instructionsLocation}</span
							>. The quick version fits most fields; use the full contract if there's room.
						</span>
					</div>
				{/if}
			</CardContent>
		</Card>
	{:else}
		<Card>
			<CardHeader>
				<CardTitle class="flex items-center gap-2 text-base">
					<Sparkles class="size-4" /> 3. Memory instructions
				</CardTitle>
				<CardDescription>
					{current.name} reads the server's built-in instructions automatically — nothing to paste.
				</CardDescription>
			</CardHeader>
		</Card>
	{/if}

	<Card>
		<CardHeader>
			<CardTitle class="flex items-center gap-2 text-base">
				<KeyRound class="size-4" /> Your access token
			</CardTitle>
			<CardDescription
				>Used for Bearer-token clients (Claude Code, Cursor, Zed). OAuth clients sign in separately.</CardDescription
			>
		</CardHeader>
		<CardContent class="space-y-3">
			<div class="flex items-center gap-2">
				<code class="flex-1 truncate rounded-md bg-muted px-3 py-2 text-sm">
					{auth.token ? `${auth.token.slice(0, 8)}…${auth.token.slice(-4)}` : 'Not signed in'}
				</code>
				<Button
					variant="outline"
					size="sm"
					onclick={() => copy(auth.token, 'token')}
					disabled={!auth.token}
					class="gap-1"
				>
					{#if copied === 'token'}<Check class="size-4" />{:else}<Copy class="size-4" />{/if}
					Copy
				</Button>
			</div>
			<p class="text-xs text-muted-foreground">
				Keep this token private — it grants full read/write access to your memory.
			</p>
		</CardContent>
	</Card>

	<Card>
		<CardHeader>
			<CardTitle class="text-base">All supported clients</CardTitle>
			<CardDescription>Web platforms use OAuth; local editors use the Bearer token.</CardDescription
			>
		</CardHeader>
		<CardContent>
			<div class="overflow-x-auto">
				<table class="w-full text-sm">
					<thead>
						<tr class="border-b text-left text-xs text-muted-foreground">
							<th class="pr-4 pb-2 font-medium">Client</th>
							<th class="pr-4 pb-2 font-medium">Auth</th>
							<th class="pb-2 font-medium">Steps</th>
						</tr>
					</thead>
					<tbody>
						{#each targets as t (t.id)}
							<tr class="border-b last:border-0">
								<td class="py-3 pr-4 font-medium">{t.name}</td>
								<td class="py-3 pr-4">
									<Badge variant={t.auth === 'OAuth' ? 'secondary' : 'outline'}>{t.auth}</Badge>
								</td>
								<td class="py-3">
									<ol class="list-inside list-decimal space-y-0.5 text-xs text-muted-foreground">
										{#each t.steps as s (s)}
											<li>{s}</li>
										{/each}
									</ol>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</CardContent>
	</Card>

	<Card>
		<CardContent class="flex items-start gap-3 p-4">
			<ExternalLink class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
			<p class="text-sm text-muted-foreground">
				Web AIs (ChatGPT, Grok, Perplexity, Le Chat) use OAuth 2.1 — paste the URL and sign in with
				your dashboard password. Local editors (Claude Code, Cursor, Zed) use the Bearer token.
			</p>
		</CardContent>
	</Card>
</div>
