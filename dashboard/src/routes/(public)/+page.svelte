<script lang="ts">
	import {
		Search,
		Network,
		RefreshCw,
		Layers,
		Plug,
		Zap,
		ExternalLink,
		ArrowRight,
		Database,
		Shield,
		Server,
		Globe,
		Rocket,
		Infinity,
		Gauge,
		Download,
		ShieldCheck,
		Code,
		KeyRound,
		MessagesSquare,
		ArrowRightLeft,
		Terminal,
		Copy,
		Check,
		Sparkles
	} from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import favicon from '$lib/assets/favicon.svg?no-inline';
	import HeroGraph from '$lib/components/landing/hero-graph.svelte';
	import ToolBreadth from '$lib/components/landing/tool-breadth.svelte';
	import MemoryGrowth from '$lib/components/landing/memory-growth.svelte';
	import ArchitectureFlow from '$lib/components/landing/architecture-flow.svelte';
	import RecallDemo from '$lib/components/landing/recall-demo.svelte';

	const INSTALL_URL = 'https://sepia.fly.dev/install';

	let copied = $state('');
	async function copy(text: string, key: string) {
		await navigator.clipboard.writeText(text);
		copied = key;
		setTimeout(() => (copied = ''), 1500);
	}

	const features = [
		{
			icon: Database,
			title: 'Knowledge graph',
			desc: 'Entities, weighted relations, and memories with importance scoring — structured like how your brain actually works.',
			color: 'text-orange-400'
		},
		{
			icon: Search,
			title: 'Unified search',
			desc: 'Keyword + metadata search across everything. BFS graph traversal from any entity. Find what your AI stored.',
			color: 'text-amber-400'
		},
		{
			icon: RefreshCw,
			title: 'Self-maintaining',
			desc: 'Decay scoring, deduplication, and purge — pure SQL, no LLM calls. The consolidate tool keeps your graph clean.',
			color: 'text-yellow-500'
		},
		{
			icon: Layers,
			title: 'Namespaced',
			desc: "Isolate memory into spaces — per project, per client, per context. Your AI knows which world it's in.",
			color: 'text-brand'
		},
		{
			icon: Zap,
			title: 'Zero-reminder recall',
			desc: "Server instructions auto-injected into your AI's system prompt. Your agents remember without you asking.",
			color: 'text-amber-300'
		},
		{
			icon: Shield,
			title: 'Self-hosted',
			desc: 'Your data stays on your infrastructure. No SaaS dependency. Bearer token for editors, OAuth for web AIs.',
			color: 'text-red-400'
		}
	];

	const tools = [
		{ name: 'Claude Code', category: 'editor' },
		{ name: 'Cursor', category: 'editor' },
		{ name: 'Copilot', category: 'editor' },
		{ name: 'Codex', category: 'editor' },
		{ name: 'Zed', category: 'editor' },
		{ name: 'OpenCode', category: 'editor' },
		{ name: 'Claude (web)', category: 'web' },
		{ name: 'ChatGPT', category: 'web' },
		{ name: 'Grok', category: 'web' },
		{ name: 'Gemini', category: 'web' },
		{ name: 'Perplexity', category: 'web' },
		{ name: 'Le Chat', category: 'web' }
	];
</script>

<svelte:head>
	<title>Sepia — Memory Server for AI Agents</title>
	<meta
		name="description"
		content="A self-hosted, remote knowledge-graph memory server for AI agents. Connect Grok, ChatGPT, and your editor in 60 seconds. Conversation ingest — switch AIs mid-task, resume with a distilled digest. 7 MCP tools, $0/month, your data stays yours."
	/>
</svelte:head>

<!-- Hero -->
<section class="relative flex min-h-screen items-center overflow-hidden px-4 py-24">
	<!-- Ambient glow -->
	<div
		class="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(212,149,106,0.08)_0%,transparent_50%),radial-gradient(ellipse_at_top_left,transparent_0%,var(--background)_72%)]"
		aria-hidden="true"
	></div>

	<div
		class="relative z-10 mx-auto grid w-full max-w-6xl items-center gap-14 lg:grid-cols-[1fr_1.1fr]"
	>
		<div>
			<div class="mb-6 flex items-center gap-3">
				<div
					class="flex size-16 items-center justify-center rounded-2xl bg-brand/15 ring-1 ring-brand/25"
				>
					<img src={favicon} alt="" class="size-8" />
				</div>
				<Badge class="gap-1.5 bg-emerald-500/15 py-1.5 text-emerald-400 hover:bg-emerald-500/15">
					<Infinity class="size-3.5" /> Free forever · $0/month
				</Badge>
			</div>

			<p
				class="mb-4 flex items-center gap-2 text-xs font-medium tracking-wider text-muted-foreground uppercase"
			>
				<span class="size-1.5 rounded-full bg-emerald-400"></span>
				OAuth 2.1 · ChatGPT + Grok support · Conversation ingest
			</p>

			<h1
				class="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl lg:text-6xl"
				style="letter-spacing: -0.03em"
			>
				One memory server.<br />Every AI you use.
			</h1>

			<p class="mt-5 max-w-xl text-lg text-muted-foreground sm:text-xl">
				Every new session, your AI starts from zero. Sepia gives
				<span class="font-medium text-foreground">Grok, ChatGPT, Claude, and your editor</span>
				one shared knowledge graph — connect in 60 seconds, install in one line, and your AI never forgets.
				Switching AIs mid-task? Sepia ingests the conversation and the next model resumes with a distilled
				digest — decisions, preferences, open questions.
			</p>

			<div class="mt-8 flex flex-wrap items-center gap-3">
				<a href="#install">
					<Button size="lg" class="gap-2 px-6">
						<Download class="size-4" /> Install in one line <ArrowRight class="size-4" />
					</Button>
				</a>
				<a href="/app/connect">
					<Button variant="outline" size="lg" class="gap-2 px-6">
						<Globe class="size-4" /> Connect an AI
					</Button>
				</a>
			</div>

			<div class="mt-10 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
				<Badge variant="secondary" class="gap-1 font-mono">
					<Globe class="size-3" /> 12 AI tools
				</Badge>
				<span class="text-border">·</span>
				<Badge variant="secondary" class="gap-1 font-mono">
					<Gauge class="size-3" /> 7 MCP tools
				</Badge>
				<span class="text-border">·</span>
				<Badge variant="secondary" class="gap-1 font-mono">
					<Rocket class="size-3" /> 60-second setup
				</Badge>
				<span class="text-border">·</span>
				<Badge variant="secondary" class="gap-1 font-mono">
					<Shield class="size-3" /> Self-hosted
				</Badge>
			</div>
		</div>

		<div class="relative">
			<HeroGraph />
		</div>
	</div>

	<!-- Scroll hint -->
	<div class="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce text-muted-foreground/40">
		<svg
			width="20"
			height="20"
			viewBox="0 0 20 20"
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
		>
			<path d="M10 4v12M5 11l5 5 5-5" />
		</svg>
	</div>
</section>

<!-- Trust strip -->
<section class="border-y border-border/50">
	<div
		class="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-8 gap-y-3 px-4 py-5 text-sm text-muted-foreground"
	>
		<a
			href="https://github.com/Michael-Obele/sepia"
			target="_blank"
			rel="noopener"
			class="flex items-center gap-2 transition-colors hover:text-foreground"
		>
			<Code class="size-4 text-brand" />
			Open source on GitHub
		</a>
		<span class="flex items-center gap-2">
			<ShieldCheck class="size-4 text-emerald-400" /> No telemetry
		</span>
		<span class="flex items-center gap-2">
			<Server class="size-4 text-brand" /> Self-hosted — your data stays yours
		</span>
		<span class="flex items-center gap-2">
			<KeyRound class="size-4 text-amber-400" /> No account required
		</span>
	</div>
</section>

<!-- Works with every AI — tools grid + connect steps -->
<section class="relative px-4 py-24 sm:py-32">
	<div class="mx-auto max-w-5xl">
		<div class="mx-auto max-w-2xl text-center">
			<Badge variant="outline" class="mb-4 font-mono text-xs tracking-wider uppercase"
				>Online AI + editors</Badge
			>
			<h2
				class="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl"
				style="letter-spacing: -0.03em"
			>
				Works with every AI you use.
			</h2>
			<p class="mt-4 text-muted-foreground">
				Local editors via Bearer token. Web AIs via OAuth 2.1. One memory server, all your tools.
			</p>
		</div>

		<div class="mt-12 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
			{#each tools as tool (tool.name)}
				<div
					class="flex items-center gap-2 rounded-lg border border-border/50 bg-card/30 px-4 py-3 text-sm text-foreground transition-colors hover:border-border hover:bg-card/60"
				>
					<span
						class="size-1.5 rounded-full {tool.category === 'editor'
							? 'bg-teal-400'
							: 'bg-violet-400'}"
					></span>
					{tool.name}
				</div>
			{/each}
		</div>

		<div class="mt-6 flex items-center justify-center gap-4 text-xs text-muted-foreground">
			<span class="flex items-center gap-1.5">
				<span class="size-1.5 rounded-full bg-teal-400"></span> Local editor
			</span>
			<span class="flex items-center gap-1.5">
				<span class="size-1.5 rounded-full bg-violet-400"></span> Web AI
			</span>
		</div>

		<!-- Connect CTA band — the how-to lives on the connect page -->
		<div
			class="relative mt-16 overflow-hidden rounded-2xl border border-brand/25 bg-linear-to-br from-brand/10 via-card/50 to-card/50 p-8 sm:p-10"
		>
			<div
				class="pointer-events-none absolute -top-24 -right-24 size-64 rounded-full bg-brand/10 blur-3xl"
				aria-hidden="true"
			></div>
			<div
				class="relative flex flex-col items-start gap-6 sm:flex-row sm:items-center sm:justify-between"
			>
				<div class="max-w-xl">
					<div class="mb-3 flex items-center gap-2">
						<div
							class="flex size-9 items-center justify-center rounded-lg bg-brand/15 ring-1 ring-brand/25"
						>
							<Sparkles class="size-4 text-brand" />
						</div>
						<Badge class="bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/15">
							<Check class="size-3" /> 60-second setup
						</Badge>
					</div>
					<h3
						class="text-2xl font-semibold tracking-tight text-foreground"
						style="letter-spacing: -0.03em"
					>
						Connect your AI in 60 seconds.
					</h3>
					<p class="mt-2 text-sm leading-relaxed text-muted-foreground">
						Paste one URL, sign in with your dashboard password, done. Step-by-step guides for
						ChatGPT, Grok, Claude, and every editor — plus your access token, ready to copy.
					</p>
				</div>
				<a href="/app/connect" class="shrink-0">
					<Button size="lg" class="gap-2 px-6">
						<Plug class="size-4" /> Connect an AI <ArrowRight class="size-4" />
					</Button>
				</a>
			</div>
		</div>
	</div>
</section>

<!-- Install in one line — full per-editor guide lives on the connect page -->
<section id="install" class="relative px-4 py-24 sm:py-32">
	<div class="mx-auto max-w-5xl">
		<div class="mx-auto max-w-2xl text-center">
			<Badge variant="outline" class="mb-4 font-mono text-xs tracking-wider uppercase"
				>Always-on memory</Badge
			>
			<h2
				class="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl"
				style="letter-spacing: -0.03em"
			>
				Install once.<br />Every editor remembers forever.
			</h2>
			<p class="mt-4 text-lg text-muted-foreground">
				One command installs the <span class="font-medium text-foreground">skill (on-demand)</span>
				+ <span class="font-medium text-foreground">always-on instructions (every session)</span> for
				VS Code, Cursor, OpenCode, and Zed. No reminder prompts.
			</p>
		</div>

		<div class="mx-auto mt-10 max-w-2xl rounded-xl border border-border/50 bg-card/50 p-6">
			<div class="flex items-center gap-2 rounded-lg bg-muted p-3 font-mono text-sm">
				<Terminal class="size-4 shrink-0 text-muted-foreground" />
				<code class="flex-1 truncate text-foreground">curl -fsSL {INSTALL_URL} | bash</code>
				<Button
					variant="ghost"
					size="icon-sm"
					onclick={() => copy(`curl -fsSL ${INSTALL_URL} | bash`, 'oneliner')}
					aria-label="Copy one-liner"
				>
					{#if copied === 'oneliner'}<Check class="size-4 text-green-500" />{:else}<Copy
							class="size-4"
						/>{/if}
				</Button>
			</div>
			<div class="mt-4 flex flex-wrap items-center justify-between gap-3">
				<p class="text-xs leading-relaxed text-muted-foreground">
					Add <code class="rounded bg-muted px-1 font-mono">SEPIA_TOKEN=YOUR_TOKEN</code> to also patch
					your MCP configs. Per-editor snippets, the access token, and web-AI guides live on the connect
					page.
				</p>
				<a href="/app/connect#editors" class="shrink-0">
					<Button variant="outline" size="sm" class="gap-1.5">
						Full per-editor guide <ArrowRight class="size-3.5" />
					</Button>
				</a>
			</div>
		</div>
	</div>
</section>

<!-- Features -->
<section class="relative px-4 py-24 sm:py-32">
	<div class="mx-auto max-w-5xl">
		<div class="mx-auto max-w-2xl text-center">
			<h2
				class="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl"
				style="letter-spacing: -0.03em"
			>
				Everything your AI needs to remember.
			</h2>
			<p class="mt-4 text-lg text-muted-foreground">
				Not a chat log. Not a JSONL file. A real knowledge graph with search, traversal, and
				maintenance — plus conversation ingest, so your next AI picks up a distilled digest, not a
				transcript dump.
			</p>
		</div>

		<div class="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
			<!-- Featured: conversation ingest — the headline new capability -->
			<div
				class="relative overflow-hidden rounded-xl border border-brand/30 bg-linear-to-br from-brand/10 via-card/50 to-card/50 p-6 sm:col-span-2 lg:col-span-3"
			>
				<Badge class="mb-4 bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/15">New</Badge>
				<div class="flex items-start gap-4">
					<div class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand/15">
						<MessagesSquare class="size-5 text-brand" />
					</div>
					<div>
						<h3 class="text-base font-semibold text-foreground">Conversation ingest</h3>
						<p class="mt-2 text-sm leading-relaxed text-muted-foreground">
							Tell any AI “save this conversation” — Sepia distills it into a digest of decisions,
							preferences, and open questions. Switch to another AI and resume exactly where you
							left off. No re-explaining.
						</p>
					</div>
				</div>
			</div>

			{#each features as f (f.title)}
				<div
					class="group relative rounded-xl border border-border/50 bg-card/50 p-6 transition-colors hover:border-border hover:bg-card"
				>
					<div class="mb-4 flex size-10 items-center justify-center rounded-lg bg-muted/50">
						<f.icon class="size-5 {f.color}" />
					</div>
					<h3 class="text-base font-semibold text-foreground">{f.title}</h3>
					<p class="mt-2 text-sm leading-relaxed text-muted-foreground">{f.desc}</p>
				</div>
			{/each}
		</div>

		<div class="mt-20 grid items-center gap-12 lg:grid-cols-2">
			<div>
				<h3
					class="text-2xl font-semibold tracking-tight text-foreground"
					style="letter-spacing: -0.03em"
				>
					Seven tools. One server.
				</h3>
				<p class="mt-3 text-muted-foreground">
					23 operations across 7 MCP tools. Rich CRUD for entities, memories, and namespaces — plus
					focused search, traversal, and maintenance. All pure SQL, no LLM calls.
				</p>
				<div class="mt-6 flex flex-wrap gap-2">
					{#each ['manage_entity', 'manage_memory', 'manage_namespace', 'manage_relation', 'search', 'traverse_graph', 'consolidate'] as tool (tool)}
						<Badge variant="outline" class="font-mono">{tool}</Badge>
					{/each}
				</div>
			</div>
			<div class="rounded-xl border border-border/50 bg-card/40 p-4">
				<ToolBreadth />
			</div>
		</div>
	</div>
</section>

<!-- Conversation ingest -->
<section class="relative px-4 py-24 sm:py-32">
	<div class="mx-auto max-w-5xl">
		<div class="grid items-center gap-12 lg:grid-cols-2">
			<div>
				<Badge class="mb-4 bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/15">New</Badge>
				<h2
					class="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl"
					style="letter-spacing: -0.03em"
				>
					Switch AIs mid-task.<br />Lose nothing.
				</h2>
				<p class="mt-4 text-muted-foreground">
					Tell any AI “save this conversation”. Sepia ingests it as a distilled digest — decisions,
					preferences, open questions — and the next model resumes with the signal, not the noise.
				</p>
				<div class="mt-8 space-y-3">
					<div class="flex items-start gap-3">
						<MessagesSquare class="mt-0.5 size-4 shrink-0 text-brand" />
						<div>
							<p class="text-sm font-medium text-foreground">Distilled, not dumped</p>
							<p class="text-sm text-muted-foreground">
								A digest of decisions, preferences, and open questions — not a raw transcript. The
								next model gets the signal, not the noise.
							</p>
						</div>
					</div>
					<div class="flex items-start gap-3">
						<ArrowRightLeft class="mt-0.5 size-4 shrink-0 text-amber-400" />
						<div>
							<p class="text-sm font-medium text-foreground">Resume in any AI</p>
							<p class="text-sm text-muted-foreground">
								Claude → Copilot → Grok. One digest, pasted anywhere, and the new model picks up
								exactly where you left off.
							</p>
						</div>
					</div>
					<div class="flex items-start gap-3">
						<ShieldCheck class="mt-0.5 size-4 shrink-0 text-emerald-400" />
						<div>
							<p class="text-sm font-medium text-foreground">Evidence kept verbatim</p>
							<p class="text-sm text-muted-foreground">
								Every decision and preference is stored as a searchable memory — the transcript
								stays optional.
							</p>
						</div>
					</div>
				</div>
			</div>

			<!-- Digest mock — mirrors the real conversation detail page -->
			<div class="rounded-xl border border-border/50 bg-card/40 p-4">
				<div class="rounded-lg border border-border/50 bg-background/60 p-5">
					<div class="flex items-center justify-between gap-3">
						<div class="flex items-center gap-2">
							<MessagesSquare class="size-4 text-brand" />
							<p class="text-sm font-semibold text-foreground">Conversation digest</p>
						</div>
						<Badge class="bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/15">active</Badge>
					</div>
					<p class="mt-3 text-sm font-medium text-foreground">R2 file uploads — decisions</p>
					<p class="mt-1 text-xs text-muted-foreground">Saved from Claude Code · 2026-08-24</p>
					<div class="mt-4 space-y-3">
						<div>
							<p class="text-xs font-medium tracking-wider text-muted-foreground uppercase">
								Decisions
							</p>
							<ul class="mt-1.5 space-y-1.5">
								<li class="flex items-start gap-2 text-sm text-foreground">
									<Check class="mt-0.5 size-3.5 shrink-0 text-emerald-400" />
									Presigned URLs for data transfer — files never stream through the server
								</li>
								<li class="flex items-start gap-2 text-sm text-foreground">
									<Check class="mt-0.5 size-3.5 shrink-0 text-emerald-400" />
									Server-side upload with a 25MB cap
								</li>
							</ul>
						</div>
						<div>
							<p class="text-xs font-medium tracking-wider text-muted-foreground uppercase">
								Open questions
							</p>
							<ul class="mt-1.5 space-y-1.5">
								<li class="flex items-start gap-2 text-sm text-foreground">
									<span class="mt-1.5 size-1.5 shrink-0 rounded-full bg-amber-400"></span>
									Custom domain for file downloads?
								</li>
							</ul>
						</div>
					</div>
				</div>
				<p class="mt-2 text-center text-xs text-muted-foreground">
					Illustrative — paste the digest into any AI to resume.
				</p>
			</div>
		</div>
	</div>
</section>

<!-- Memory growth -->
<section class="relative px-4 py-24 sm:py-32">
	<div class="mx-auto max-w-5xl">
		<div class="grid items-center gap-12 lg:grid-cols-2">
			<div>
				<h2
					class="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl"
					style="letter-spacing: -0.03em"
				>
					Memory that compounds.
				</h2>
				<p class="mt-4 text-muted-foreground">
					Every session adds facts, relations, and preferences. Your graph grows richer over time —
					and your AI recalls it all without being reminded.
				</p>
				<div class="mt-8 space-y-3">
					<div class="flex items-start gap-3">
						<Database class="mt-0.5 size-4 shrink-0 text-brand" />
						<div>
							<p class="text-sm font-medium text-foreground">Facts, observations, preferences</p>
							<p class="text-sm text-muted-foreground">
								Memories with importance scoring — the durable context your agents build up.
							</p>
						</div>
					</div>
					<div class="flex items-start gap-3">
						<Network class="mt-0.5 size-4 shrink-0 text-amber-400" />
						<div>
							<p class="text-sm font-medium text-foreground">Weighted relations</p>
							<p class="text-sm text-muted-foreground">
								Entities connected by typed, weighted edges — a graph, not a log.
							</p>
						</div>
					</div>
					<div class="flex items-start gap-3">
						<RefreshCw class="mt-0.5 size-4 shrink-0 text-orange-400" />
						<div>
							<p class="text-sm font-medium text-foreground">Self-maintaining</p>
							<p class="text-sm text-muted-foreground">
								Decay scoring and dedup keep the graph clean — automatically.
							</p>
						</div>
					</div>
				</div>
			</div>
			<div class="rounded-xl border border-border/50 bg-card/40 p-4">
				<MemoryGrowth />
				<p class="mt-2 text-center text-xs text-muted-foreground">
					Illustrative — your graph grows as your agents work.
				</p>
			</div>
		</div>
	</div>
</section>

<!-- Recall demo -->
<section class="relative px-4 py-24 sm:py-32">
	<div class="mx-auto max-w-5xl">
		<div class="grid items-center gap-12 lg:grid-cols-2">
			<div>
				<h2
					class="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl"
					style="letter-spacing: -0.03em"
				>
					Watch your AI remember.
				</h2>
				<p class="mt-4 text-muted-foreground">
					No reminders. No "please recall". Ask anything — the answer comes back with the memory
					attached, sourced from your graph.
				</p>
				<div class="mt-8 space-y-3">
					<div class="flex items-start gap-3">
						<Search class="mt-0.5 size-4 shrink-0 text-brand" />
						<div>
							<p class="text-sm font-medium text-foreground">Unified search</p>
							<p class="text-sm text-muted-foreground">
								One query across memories, entities, and relations.
							</p>
						</div>
					</div>
					<div class="flex items-start gap-3">
						<Network class="mt-0.5 size-4 shrink-0 text-amber-400" />
						<div>
							<p class="text-sm font-medium text-foreground">Graph traversal</p>
							<p class="text-sm text-muted-foreground">
								BFS from any entity — the answer is one hop away.
							</p>
						</div>
					</div>
				</div>
			</div>
			<RecallDemo />
		</div>
	</div>
</section>

<!-- Architecture -->
<section class="relative px-4 py-24 sm:py-32">
	<div class="mx-auto max-w-5xl">
		<div class="grid items-center gap-12 lg:grid-cols-2">
			<div>
				<h2
					class="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl"
					style="letter-spacing: -0.03em"
				>
					Simple architecture.<br />Serious capability.
				</h2>
				<p class="mt-4 text-muted-foreground">
					One Bun process on Fly.io serves both the MCP endpoint and the REST API. The dashboard is
					a static SPA on Netlify — it never wakes your VM. Neon Postgres on the free tier handles
					persistence.
				</p>
				<div class="mt-8 space-y-3">
					<div class="flex items-start gap-3">
						<Server class="mt-0.5 size-4 shrink-0 text-brand" />
						<div>
							<p class="text-sm font-medium text-foreground">Scale-to-zero</p>
							<p class="text-sm text-muted-foreground">
								The Fly machine only spins up for real API calls. The CDN-served dashboard is always
								fast.
							</p>
						</div>
					</div>
					<div class="flex items-start gap-3">
						<Shield class="mt-0.5 size-4 shrink-0 text-brand" />
						<div>
							<p class="text-sm font-medium text-foreground">Two-phase auth</p>
							<p class="text-sm text-muted-foreground">
								Bearer tokens for local editors. OAuth 2.1 + PKCE for web AIs like ChatGPT and
								Gemini.
							</p>
						</div>
					</div>
					<div class="flex items-start gap-3">
						<Plug class="mt-0.5 size-4 shrink-0 text-brand" />
						<div>
							<p class="text-sm font-medium text-foreground">Works everywhere</p>
							<p class="text-sm text-muted-foreground">
								12 AI tools supported out of the box — local editors and web-based AIs alike.
							</p>
						</div>
					</div>
				</div>
			</div>

			<!-- Architecture flow -->
			<div class="m-4 rounded-xl border border-border/50 bg-card/40 p-2">
				<ArchitectureFlow />
			</div>
		</div>
	</div>
</section>

<!-- Deploy CTA -->
<section class="relative px-4 py-24 sm:py-32">
	<div class="mx-auto max-w-3xl text-center">
		<h2
			class="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl"
			style="letter-spacing: -0.03em"
		>
			Deploy in 10 minutes. Free forever.
		</h2>
		<p class="mx-auto mt-4 max-w-xl text-muted-foreground">
			Fly.io free tier + Neon Postgres free tier + Netlify free tier. Your AI gets persistent memory
			for $0/month.
		</p>

		<!-- Contrast anchor -->
		<div class="mx-auto mt-10 grid max-w-2xl gap-3 text-left sm:grid-cols-3">
			<div class="rounded-xl border border-border/50 bg-card/40 p-4">
				<p class="text-xs font-medium tracking-wider text-muted-foreground uppercase">
					Hosted memory APIs
				</p>
				<p class="mt-1 text-sm text-foreground">Per-seat pricing, your data on their servers</p>
			</div>
			<div class="rounded-xl border border-border/50 bg-card/40 p-4">
				<p class="text-xs font-medium tracking-wider text-muted-foreground uppercase">
					Building your own
				</p>
				<p class="mt-1 text-sm text-foreground">A weekend of work, then maintenance forever</p>
			</div>
			<div class="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
				<p class="text-xs font-medium tracking-wider text-emerald-400 uppercase">Sepia</p>
				<p class="mt-1 text-sm text-foreground">$0/month · 10 minutes · your infrastructure</p>
			</div>
		</div>

		<div class="mx-auto mt-10 max-w-lg rounded-xl border border-border/50 bg-card/50 p-6 text-left">
			<p class="mb-3 text-xs font-medium tracking-wider text-muted-foreground uppercase">
				Quick start
			</p>
			<div class="space-y-1.5 font-mono text-sm">
				<p class="text-muted-foreground">
					<span class="text-brand">$</span> fly launch
				</p>
				<p class="text-emerald-400/80">→ App created · machine deployed</p>
				<p class="text-muted-foreground">
					<span class="text-brand">$</span> fly secrets set DATABASE_URL=... AUTH_TOKEN=...
				</p>
				<p class="text-emerald-400/80">→ Secrets are set</p>
				<p class="text-muted-foreground">
					<span class="text-brand">$</span> open
					<span class="text-amber-400">https://your-app.fly.dev/mcp</span>
				</p>
				<p class="text-emerald-400/80">→ Paste this URL into your AI — done</p>
			</div>
		</div>

		<div class="mt-10 flex flex-wrap items-center justify-center gap-3">
			<a href="https://github.com/Michael-Obele/sepia" target="_blank" rel="noopener">
				<Button size="lg" class="gap-2 px-6">
					<ExternalLink class="size-4" /> Read the docs
				</Button>
			</a>
			<a href="/app">
				<Button variant="outline" size="lg" class="gap-2 px-6">
					Try the dashboard <ExternalLink class="size-4" />
				</Button>
			</a>
		</div>
	</div>
</section>
