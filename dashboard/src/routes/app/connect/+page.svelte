<script lang="ts">
	import {
		Copy,
		Check,
		Server,
		KeyRound,
		ExternalLink,
		Globe,
		Sparkles,
		Cable,
		MonitorSmartphone,
		Terminal,
		FileText,
		Layers,
		Zap,
		Shield,
		CircleCheck,
		TriangleAlert,
		Eye,
		EyeOff
	} from '@lucide/svelte';
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
	const BASE = 'https://sepia.fly.dev';

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

	// Goal gradient: the stepper adapts to the auth path — OAuth AIs authorize,
	// Bearer editors paste a config and verify.
	const oauthSteps = ['Pick your AI', 'Copy the URL', 'Authorize', 'Add instructions'];
	const bearerSteps = ['Pick your AI', 'Copy the config', 'Add your token', 'Verify'];
	const steps = $derived(current.auth === 'OAuth' ? oauthSteps : bearerSteps);

	// Smart default: configs are pre-filled with the real token — scan and adjust, not type.
	const token = $derived(auth.token || 'YOUR_TOKEN');

	// The token is a Better Auth session token — it expires (7-day sliding
	// window) and rotates on every sign-in. Configs are derived so they always
	// carry the current token; the display masks it until revealed.
	function maskToken(t: string): string {
		if (t === 'YOUR_TOKEN' || t.length <= 8) return t;
		return `${t.slice(0, 4)}••••••••${t.slice(-4)}`;
	}
	const maskedToken = $derived(maskToken(token));

	function buildBearer(t: string) {
		return `{
  "mcpServers": {
    "sepia": {
      "type": "http",
      "url": "${MCP_URL}",
      "headers": {
        "Authorization": "Bearer ${t}"
      }
    }
  }
}`;
	}
	const bearerConfig = $derived(buildBearer(token));
	const displayBearerConfig = $derived(buildBearer(maskedToken));

	function buildConfigs(t: string) {
		return {
			vscode: `{
  "servers": {
    "sepia": {
      "type": "http",
      "url": "${MCP_URL}",
      "headers": {
        "Authorization": "Bearer ${t}"
      }
    }
  }
}`,
			cursor: `{
  "mcpServers": {
    "sepia": {
      "type": "http",
      "url": "${MCP_URL}",
      "headers": {
        "Authorization": "Bearer ${t}"
      }
    }
  }
}`,
			opencode: `{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "sepia": {
      "type": "remote",
      "url": "${MCP_URL}",
      "enabled": true,
      "headers": {
        "Authorization": "Bearer ${t}"
      }
    }
  }
}`,
			zedRemote: `{
  "context_servers": {
    "sepia": {
      "url": "${MCP_URL}",
      "headers": {
        "Authorization": "Bearer ${t}"
      }
    }
  }
}`,
			zedBridge: `{
  "context_servers": {
    "sepia": {
      "source": "custom",
      "command": "npx",
      "args": [
        "-y", "mcp-remote",
        "${MCP_URL}",
        "--header", "Authorization: Bearer ${t}"
      ],
      "env": {}
    }
  }
}`,
			claude: `claude mcp add --transport http sepia ${MCP_URL} --header "Authorization: Bearer ${t}"`
		};
	}
	const editorConfigs = $derived(buildConfigs(token));
	const displayConfigs = $derived(buildConfigs(maskedToken));

	const oneLiner = $derived(`SEPIA_TOKEN=${token} curl -fsSL ${BASE}/install | bash`);
	const displayOneLiner = $derived(`SEPIA_TOKEN=${maskedToken} curl -fsSL ${BASE}/install | bash`);
	const oneLinerGlobal = $derived(
		`SEPIA_TOKEN=${token} SEPIA_SCOPE=global curl -fsSL ${BASE}/install | bash`
	);
	const displayOneLinerGlobal = $derived(
		`SEPIA_TOKEN=${maskedToken} SEPIA_SCOPE=global curl -fsSL ${BASE}/install | bash`
	);

	// Token visibility — hidden by default, revealed per-config via the eye toggle.
	let revealed = $state<Record<string, boolean>>({});
	function toggleReveal(key: string) {
		revealed[key] = !revealed[key];
	}

	type Editor = {
		id: string;
		label: string;
		file: string;
		key: string;
		config: keyof typeof editorConfigs;
		note: string;
	};

	const editors: Editor[] = [
		{
			id: 'vscode',
			label: 'VS Code',
			file: '.vscode/mcp.json',
			key: '"servers"',
			config: 'vscode',
			note: 'Global fallback: ~/.config/Code/User/mcp.json with "servers". The installer also adds .github/instructions/sepia.instructions.md with applyTo: "**".'
		},
		{
			id: 'cursor',
			label: 'Cursor',
			file: '.cursor/mcp.json',
			key: '"mcpServers"',
			config: 'cursor',
			note: 'Cursor uses "mcpServers" (not "servers"). Rule file: .cursor/rules/sepia.mdc with alwaysApply: true — the installer handles it.'
		},
		{
			id: 'opencode',
			label: 'OpenCode',
			file: 'opencode.json',
			key: '"mcp"',
			config: 'opencode',
			note: 'Supports both mcp.sepia (v1) and mcp.servers.sepia (v2). Place in project opencode.json or ~/.config/opencode/opencode.json. CLI alternative: opencode mcp add.'
		},
		{
			id: 'zed',
			label: 'Zed',
			file: '~/.config/zed/settings.json',
			key: '"context_servers"',
			config: 'zedRemote',
			note: 'Zed key is "context_servers" (not mcpServers). Restart Agent Panel → check green dot. Also respects ./AGENTS.md.'
		},
		{
			id: 'claude',
			label: 'Claude Code',
			file: 'Terminal',
			key: 'claude mcp add',
			config: 'claude',
			note: 'Also install the skill: npx skills add Michael-Obele/sepia — then restart Claude Code.'
		}
	];
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

	<!-- Goal gradient: step 1 pre-completed, ChatGPT pre-selected, steps adapt to auth path -->
	<Card>
		<CardContent class="p-4">
			<div class="flex flex-wrap items-center gap-2 sm:gap-3">
				{#each steps as step, i (step)}
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
						{#if i < steps.length - 1}<div class="h-px w-4 bg-border sm:w-8"></div>{/if}
					</div>
				{/each}
			</div>
			<p class="mt-3 text-xs text-muted-foreground">
				Step 1 of {steps.length} — <span class="font-medium text-foreground">{current.name}</span> is
				pre-selected. Pick a different AI below if you use one.
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
				<div class="relative">
					<pre class="overflow-x-auto rounded-md bg-muted p-4 text-xs leading-relaxed"><code
							>{revealed['config'] ? bearerConfig : displayBearerConfig}</code
						></pre>
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						class="absolute top-2 right-2 text-muted-foreground hover:text-foreground"
						aria-label={revealed['config'] ? 'Hide token' : 'Show token'}
						onclick={() => toggleReveal('config')}
					>
						{#if revealed['config']}<EyeOff class="size-4" />{:else}<Eye class="size-4" />{/if}
					</Button>
				</div>
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
						<a href="#editors" class="underline underline-offset-4 hover:text-foreground">
							per-editor configs
						</a>
						below for ready-to-paste snippets with your token.
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

	<!-- How to use the MCP server -->
	<Card>
		<CardHeader>
			<CardTitle class="flex items-center gap-2 text-base">
				<Cable class="size-4" /> How to use the MCP server
			</CardTitle>
			<CardDescription>
				Sepia speaks the Model Context Protocol over Streamable HTTP. One URL, two ways to connect —
				OAuth for web AIs, a Bearer token for local editors.
			</CardDescription>
		</CardHeader>
		<CardContent class="space-y-4">
			<div class="flex items-center gap-2">
				<code class="flex-1 truncate rounded-md bg-muted px-3 py-2 text-sm">{MCP_URL}</code>
				<Button variant="outline" size="sm" onclick={() => copy(MCP_URL, 'mcp-url')} class="gap-1">
					{#if copied === 'mcp-url'}<Check class="size-4" />{:else}<Copy class="size-4" />{/if}
					Copy URL
				</Button>
			</div>
			<div class="grid gap-3 sm:grid-cols-2">
				<div class="rounded-lg border border-violet-500/20 bg-violet-500/5 p-4">
					<div class="flex items-center gap-2">
						<Globe class="size-4 text-violet-400" />
						<p class="text-sm font-semibold text-foreground">Web AIs — OAuth 2.1</p>
					</div>
					<p class="mt-1.5 text-xs leading-relaxed text-muted-foreground">
						ChatGPT, Grok, Claude, Perplexity, Le Chat. Paste the URL into their connector settings,
						then sign in with your dashboard password once — it stays connected.
					</p>
				</div>
				<div class="rounded-lg border border-teal-500/20 bg-teal-500/5 p-4">
					<div class="flex items-center gap-2">
						<MonitorSmartphone class="size-4 text-teal-400" />
						<p class="text-sm font-semibold text-foreground">Local editors — Bearer token</p>
					</div>
					<p class="mt-1.5 text-xs leading-relaxed text-muted-foreground">
						Claude Code, Cursor, OpenCode, Zed. Add the URL to your MCP config with an Authorization
						header — your access token is below, pre-filled into every snippet.
					</p>
				</div>
			</div>
		</CardContent>
	</Card>

	<!-- How to use the access token -->
	<Card>
		<CardHeader>
			<CardTitle class="flex items-center gap-2 text-base">
				<KeyRound class="size-4" /> How to use the access token
			</CardTitle>
			<CardDescription>
				Your personal token for Bearer-token clients. It's tied to your dashboard account — anyone
				with it can read and write your memory, so keep it private.
			</CardDescription>
		</CardHeader>
		<CardContent class="space-y-4">
			<div class="flex items-center gap-2">
				<code class="flex-1 truncate rounded-md bg-muted px-3 py-2 text-sm">
					{auth.token ? (revealed['token'] ? auth.token : maskedToken) : 'Not signed in'}
				</code>
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					onclick={() => toggleReveal('token')}
					disabled={!auth.token}
					class="shrink-0 text-muted-foreground hover:text-foreground"
					aria-label={revealed['token'] ? 'Hide token' : 'Show token'}
				>
					{#if revealed['token']}<EyeOff class="size-4" />{:else}<Eye class="size-4" />{/if}
				</Button>
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
			<div
				class="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-muted-foreground"
			>
				<TriangleAlert class="mt-0.5 size-3.5 shrink-0 text-amber-500" />
				<span>
					Keep this token private — it grants full read/write access to your memory. OAuth clients
					(ChatGPT, Grok, …) sign in separately and never need it.
				</span>
			</div>

			<!-- One-line installer — patches MCP configs with the token -->
			<div class="rounded-lg border border-border/50 bg-muted p-3">
				<p
					class="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase"
				>
					<Terminal class="size-3.5" /> One-line installer — also patches MCP configs
				</p>
				<div class="space-y-1.5 font-mono text-xs">
					<div class="flex items-center gap-2">
						<code class="flex-1 truncate">{revealed['oneliner'] ? oneLiner : displayOneLiner}</code>
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							onclick={() => toggleReveal('oneliner')}
							class="shrink-0 text-muted-foreground hover:text-foreground"
							aria-label={revealed['oneliner'] ? 'Hide token' : 'Show token'}
						>
							{#if revealed['oneliner']}<EyeOff class="size-3" />{:else}<Eye class="size-3" />{/if}
						</Button>
						<Button
							variant="ghost"
							size="xs"
							onclick={() => copy(oneLiner, 'oneliner')}
							class="h-6 gap-1"
						>
							{#if copied === 'oneliner'}<Check class="size-3" />{:else}<Copy class="size-3" />{/if}
							Copy
						</Button>
					</div>
					<div class="flex items-center gap-2">
						<code class="flex-1 truncate"
							>{revealed['oneliner-global'] ? oneLinerGlobal : displayOneLinerGlobal}</code
						>
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							onclick={() => toggleReveal('oneliner-global')}
							class="shrink-0 text-muted-foreground hover:text-foreground"
							aria-label={revealed['oneliner-global'] ? 'Hide token' : 'Show token'}
						>
							{#if revealed['oneliner-global']}<EyeOff class="size-3" />{:else}<Eye
									class="size-3"
								/>{/if}
						</Button>
						<Button
							variant="ghost"
							size="xs"
							onclick={() => copy(oneLinerGlobal, 'oneliner-global')}
							class="h-6 gap-1"
						>
							{#if copied === 'oneliner-global'}<Check class="size-3" />{:else}<Copy
									class="size-3"
								/>{/if}
							Copy
						</Button>
					</div>
				</div>
				<p class="mt-2 text-xs text-muted-foreground">
					Global = one-and-done for this machine. Add
					<code class="rounded bg-muted px-1 font-mono">SEPIA_SCOPE=global</code> to skip repo
					files. Fallback:
					<code class="rounded bg-muted px-1 font-mono">npx skills add Michael-Obele/sepia</code>.
				</p>
			</div>

			<!-- Per-editor configs — real token pre-filled -->
			<div id="editors">
				<p
					class="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase"
				>
					<FileText class="size-3.5" /> Per-editor configs — token pre-filled
				</p>
				<Tabs.Root value="vscode">
					<Tabs.List class="h-auto flex-wrap gap-1 p-1">
						{#each editors as ed (ed.id)}
							<Tabs.Trigger value={ed.id} class="gap-1.5 px-3 py-1.5 text-xs sm:text-sm">
								{ed.label}
							</Tabs.Trigger>
						{/each}
					</Tabs.List>

					{#each editors as ed (ed.id)}
						<Tabs.Content value={ed.id} class="mt-4 space-y-3">
							<div class="overflow-hidden rounded-lg border border-border/50 bg-muted">
								<div
									class="flex items-center justify-between border-b border-border/50 bg-card/50 px-3 py-1.5"
								>
									<span class="font-mono text-xs text-muted-foreground">{ed.file}</span>
									<div class="flex items-center gap-1">
										<Button
											type="button"
											variant="ghost"
											size="icon-xs"
											onclick={() => toggleReveal(ed.id)}
											class="shrink-0 text-muted-foreground hover:text-foreground"
											aria-label={revealed[ed.id] ? 'Hide token' : 'Show token'}
										>
											{#if revealed[ed.id]}<EyeOff class="size-3" />{:else}<Eye
													class="size-3"
												/>{/if}
										</Button>
										<Button
											variant="ghost"
											size="xs"
											onclick={() => copy(editorConfigs[ed.config], ed.id)}
											class="h-6 gap-1"
										>
											{#if copied === ed.id}<Check class="size-3 text-green-500" /> Copy ✓{:else}<Copy
													class="size-3"
												/> Copy{/if}
										</Button>
									</div>
								</div>
								{#if ed.id === 'zed'}
									<pre class="overflow-x-auto p-3 text-xs leading-relaxed"><code
											>{revealed['zed'] ? editorConfigs.zedRemote : displayConfigs.zedRemote}</code
										></pre>
									<details class="border-t border-border/50 bg-card/30">
										<summary class="cursor-pointer px-3 py-2 text-xs font-medium text-foreground"
											>Fallback: stdio bridge via mcp-remote (older Zed) — click to show</summary
										>
										<div class="border-t border-border/50 bg-muted p-3">
											<pre class="overflow-x-auto text-xs leading-relaxed"><code
													>{revealed['zedBridge']
														? editorConfigs.zedBridge
														: displayConfigs.zedBridge}</code
												></pre>
											<Button
												variant="ghost"
												size="xs"
												onclick={() => copy(editorConfigs.zedBridge, 'zedBridge')}
												class="mt-2 h-6 gap-1"
											>
												{#if copied === 'zedBridge'}<Check class="size-3" /> Copied{:else}<Copy
														class="size-3"
													/> Copy bridge{/if}
											</Button>
										</div>
									</details>
								{:else}
									<pre class="overflow-x-auto p-3 text-xs leading-relaxed"><code
											>{revealed[ed.id]
												? editorConfigs[ed.config]
												: displayConfigs[ed.config]}</code
										></pre>
								{/if}
							</div>
							<p class="text-xs leading-relaxed text-muted-foreground">
								Key: <code class="rounded bg-muted px-1 font-mono text-xs">{ed.key}</code> — {ed.note}
							</p>
						</Tabs.Content>
					{/each}
				</Tabs.Root>
			</div>
		</CardContent>
	</Card>

	<!-- Always-on memory -->
	<Card>
		<CardHeader>
			<CardTitle class="flex items-center gap-2 text-base">
				<Zap class="size-4" /> Always-on memory
			</CardTitle>
			<CardDescription>
				Three channels make your AI remember without being asked. The installer sets up all three —
				or copy the files yourself.
			</CardDescription>
		</CardHeader>
		<CardContent class="space-y-4">
			<div class="grid gap-3 sm:grid-cols-3">
				<div class="rounded-xl border border-border/50 bg-card/40 p-4">
					<div
						class="mb-2 flex size-7 items-center justify-center rounded-md bg-amber-500/10 ring-1 ring-amber-500/20"
					>
						<Layers class="size-3.5 text-amber-500" />
					</div>
					<p class="text-sm font-semibold text-foreground">1. Skill (on-demand)</p>
					<p class="mt-1 text-xs leading-relaxed text-muted-foreground">
						Extended guide: tool schemas, examples. Loaded when memory is relevant.
					</p>
				</div>
				<div class="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
					<div
						class="mb-2 flex size-7 items-center justify-center rounded-md bg-primary/10 ring-1 ring-primary/20"
					>
						<FileText class="size-3.5 text-primary" />
					</div>
					<p class="text-sm font-semibold text-foreground">2. Always-on (every session)</p>
					<p class="mt-1 text-xs leading-relaxed text-muted-foreground">
						Injected into the system prompt. Forces <code
							class="rounded bg-muted px-1 font-mono text-xs">search</code
						> before work, persist after.
					</p>
				</div>
				<div class="rounded-xl border border-border/50 bg-card/40 p-4">
					<div
						class="mb-2 flex size-7 items-center justify-center rounded-md bg-teal-500/10 ring-1 ring-teal-500/20"
					>
						<Shield class="size-3.5 text-teal-500" />
					</div>
					<p class="text-sm font-semibold text-foreground">3. MCP server</p>
					<p class="mt-1 text-xs leading-relaxed text-muted-foreground">
						7 tools over Streamable HTTP at <code class="font-mono text-xs">{MCP_URL}</code>
					</p>
				</div>
			</div>

			<div
				class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed bg-card/30 p-4 text-sm"
			>
				<div class="flex items-center gap-2">
					<CircleCheck class="size-4 shrink-0 text-teal-500" />
					<span class="font-medium text-foreground">Verify</span>
					<span class="text-muted-foreground"
						>— restart editor, ask “what do you know about my project?”</span
					>
				</div>
				<span class="text-xs text-muted-foreground"
					>Expect: <code class="rounded bg-muted px-1 font-mono text-xs">From your memory: ...</code
					> without you prompting “use sepia”.</span
				>
			</div>
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
