# Sepia — Memory MCP Server

[![License: AGPL-3.0](https://img.shields.io/github/license/Michael-Obele/sepia)](LICENSE)

> **7 tools. 1 purpose: remember everything so your AI doesn't forget — and never needs to be reminded.**

A personal, self-hosted **remote knowledge-graph memory server for AI coding agents** — a drop-in upgrade from the official local-file memory MCP server, with:

- **7 focused MCP tools** over Streamable HTTP (not 17)
- **MCP server instructions** — a usage contract auto-injected into the model's system prompt, so your AI recalls and persists _without you asking_
- **Always-on editor instructions** — per-editor instruction files (VS Code prompts, Cursor rules, CLAUDE.md, AGENTS.md) injected into **every** session, so no editor can skip memory
- **A bundled Agent Skill** (`SKILL.md`, open standard) that teaches any editor the full usage guide
- **A web dashboard** with search, CRUD, stats, and an interactive knowledge-graph view
- **Out-of-the-box support for online AIs** that speak MCP: Grok, ChatGPT, Claude, Gemini, Perplexity
- **$0/month** on the free tiers of Fly.io + Neon Postgres + Netlify

## Why this exists

The [official MCP memory server](https://github.com/modelcontextprotocol/servers) is a single local JSONL file — no remote access, no search across sessions, no scaling. The remote alternatives are either overkill (17 tools, RBAC, audit trails, team workflows), gone (mem0 went hosted-only SaaS), or local-first (basic-memory, claude-mem).

**Nobody ships a self-hosted, single-user, remote knowledge-graph memory server with a dashboard and a skill.** That's the gap this project fills — the Goldilocks version, on infrastructure you control.

## Features

| Feature                       | What it does                                                                                                                                                                                                                                                                                   |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🧠 **Knowledge graph**        | Entities (nodes), weighted relations (edges), memories (facts/observations) with importance scoring, in isolated namespaces                                                                                                                                                                    |
| 🔎 **Search + traversal**     | Unified keyword search across everything; BFS graph traversal from any entity                                                                                                                                                                                                                  |
| 🧹 **`consolidate`**          | Idempotent maintenance sweep: decay-scoring, dedup, purge — pure SQL, no LLM calls                                                                                                                                                                                                             |
| 📋 **Server instructions**    | A usage contract sent in the MCP `initialize` handshake; supporting clients (Claude Code, Codex, Copilot, Goose) inject it into the system prompt — zero-reminder usage                                                                                                                        |
| ⚡ **Always-on instructions** | `skills/sepia/always-on/` — VS Code `*.instructions.md` (`applyTo: '**/*'`), Cursor `.mdc` (`alwaysApply: true`), `~/.claude/CLAUDE.md`, `AGENTS.md`; injected into **every** session, covering clients that ignore `instructions` (Cursor)                                                    |
| 🛠️ **Bundled Agent Skill**    | `skills/sepia/SKILL.md` (agentskills.io standard) — works in Zed, Cursor, Claude Code, Codex, OpenCode; the on-demand extended guide (tool-by-tool detail)                                                                                                                                     |
| � **Conversation migration**  | `manage_memory` action=ingest — save a distilled handoff digest (summary + decisions + preferences + entities) that any other AI can resume; digests are protected from consolidation and grouped by `conversation_id`                                                                         |
| 🖥️ **Web dashboard**          | SvelteKit app on Netlify (SSR + remote functions): landing + pricing pages, search with URL-backed filters, graph view, conversations, stats, and a "Connect an AI" page — never wakes the API's scaled-to-zero machine                                                                        |
| 🌐 **Online AI support**      | Grok, ChatGPT, Claude web, Gemini (Spark), Perplexity, Le Chat all accept remote MCP connectors — your memory follows you to the web                                                                                                                                                           |
| 🔐 **Two-phase auth**         | Phase 1: static Bearer token (local editors). Phase 2: **OAuth 2.1 + PKCE live** — built-in authorization server via `@tmcp/auth` (login page, dynamic client registration, Client ID Metadata Documents) for Grok/ChatGPT/Gemini-style connectors. Hosted accounts with plans are in progress |

## Architecture

```
                        ┌─────────────────────────────────┐
                        │         Browser (you)            │
                        │  sepia.svelte-apps.me            │
                        │  Dashboard (SvelteKit SSR,       │
                        │  served from Netlify)            │
                        └───────────────┬─────────────────┘
                                        │ HTTPS + Bearer token / PKCE
                                        ▼
┌────────────────────────┐   ┌────────────────────────────────────┐
│       MCP Clients       │   │       Fly.io App (Bun.serve)       │
│                         │   │                                    │
│  Local: Cursor, Zed,    │──▶│  /mcp     TMCP server (7 tools +   │
│  Claude Code, Copilot,  │   │           instructions)            │
│  OpenCode               │   │  /api/*   REST (same auth, CORS    │
│  Web: Grok, ChatGPT,    │   │           allowlist)               │
│  Claude.ai, Gemini,     │   └───────────────┬────────────────────┘
│  Perplexity             │                   │ @neondatabase/serverless
└────────────────────────┘                   ▼
                              ┌────────────────────────────────────┐
                              │      Neon Postgres (Free Tier)      │
                              │  namespaces · entities · relations  │
                              └────────────────────────────────────┘
```

**Stack:** Bun · TMCP (Valibot adapters, `HttpTransport`) · Neon Postgres · **Drizzle ORM** (type-safe query builder + `sql` template + migrations) · Svelte 5/SvelteKit (`adapter-netlify`, SSR + remote functions) · Tailwind CSS v4 · cytoscape.js

**Key decision:** the MCP endpoint and the REST API share **one Bun process** on **one Fly.io machine** — TMCP's `HttpTransport` mounts at `/mcp` inside an existing `Bun.serve`. The dashboard is a **SvelteKit app on Netlify** (SSR + remote functions): free tier, and it never wakes the Fly VM (which scales to zero) — the machine only spins up for real API calls from agents.

```mermaid
flowchart LR
    subgraph Clients
        L[Local editors<br/>Cursor · Zed · Claude Code<br/>Copilot · OpenCode]
        W[Online AIs<br/>Grok · ChatGPT · Claude<br/>Gemini · Perplexity]
    end
    subgraph Fly["Fly.io (scale-to-zero)"]
        B[Bun.serve]
        M["/mcp — TMCP server<br/>7 tools + instructions"]
        A["/api/* — REST<br/>CORS allowlist"]
    end
    N[(Neon Postgres<br/>free tier)]
    D[Netlify<br/>Dashboard app]
    L --> M
    W --> M
    B --> N
    D -- "fetch /api/*" --> A
```

## The 7 Tools

| #   | Tool               | Actions                                                  | What it does                                                                 |
| --- | ------------------ | -------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1   | `manage_namespace` | create, list, get, delete                                | Organize memory into isolated spaces                                         |
| 2   | `manage_entity`    | create, get, update, delete, find, batch_update          | Knowledge graph nodes (people, concepts, projects, tools)                    |
| 3   | `manage_relation`  | create, delete, list                                     | Directed, weighted edges between entities                                    |
| 4   | `manage_memory`    | create, get, update, delete, query, batch_update, ingest | Facts/observations/preferences with importance scoring; conversation digests |
| 5   | `search`           | —                                                        | Unified keyword + metadata search across all data                            |
| 6   | `traverse_graph`   | —                                                        | BFS walk of the knowledge graph from an entity                               |
| 7   | `consolidate`      | —                                                        | Decay sweep + dedup + purge (idempotent maintenance)                         |

**Why 7 instead of 17:** FlarelyLegal's 17 tools split entity search, memory queries, conversations, and admin into separate tools. By using `action` enums inside `manage_*` tools, the LLM surface stays clean while covering all capabilities — including conversation migration (`manage_memory` action=ingest) and bulk updates (`batch_update`). No RBAC, no audit trails — those are team features a personal server doesn't need. Semantic/vector search is a deliberate future upgrade; `search` ships keyword + metadata for v1.

## Remember Without Being Asked

Three complementary channels, one contract (`src/instructions.ts`):

1. **MCP `instructions` field** — the server sends a usage contract in the `initialize` handshake; clients that support it (Claude Code, Codex, VS Code Copilot Chat, Goose, Claude Desktop) inject it into the model's system prompt. The model recalls before working and persists after learning — no reminder prompts.
2. **Always-on instruction files** (`skills/sepia/always-on/`) — the same condensed contract, installed into each editor's own instruction system: VS Code `*.instructions.md` with `applyTo: '**/*'` (auto-attached to every chat request), Cursor `.mdc` with `alwaysApply: true` (every session, unconditionally), a section in `~/.claude/CLAUDE.md` (loaded at session start), and an `AGENTS.md` section for Codex/other agents. Skills are on-demand by design in every platform, so this channel is what actually **forces** memory usage in editors that ignore `instructions` (Cursor).
3. **Bundled Agent Skill** (`skills/sepia/SKILL.md`) — the extended guide (tool-by-tool detail, examples, edge cases), delivered through the open Agent Skills standard. Loads when memory is relevant.

The contract teaches: **search before meaningful work**, **persist durable facts** (preferences, decisions, conventions), **prefer update over duplicate**, **link memories to entities**, **score importance 0–1**, **never store credentials or ephemeral chat content** — and **migrate conversations between AIs** via `manage_memory` action=ingest (handoff digests with status: active/paused/done).

## The Dashboard

A SvelteKit app at `sepia.svelte-apps.me` (SSR + remote functions on Netlify), talking to the same database through `/api/*`:

- 🏠 **Landing + pricing pages** — what Sepia is, how to install it, and the hosted plan
- 🔍 Search all memories/entities; browse by namespace, type, importance — filters persist in the URL (back/forward works)
- 🕸️ Interactive knowledge-graph view (cytoscape.js + dagre)
- ✏️ CRUD on memories, entities, and relations from the browser
- 💬 **Conversations** — browse handoff digests by status (active/paused/done), resume or delete them
- 📊 Stats: counts, top entities, recent memories, decay/consolidation status
- 🔗 **Connect an AI** page: copy-paste configs for Grok, ChatGPT, Claude, Gemini, Perplexity, and the local editors

## Project Structure

A **Bun workspace monorepo**: one repo, one lockfile, three deploy entries — Fly.io builds the server from the root `Dockerfile`, Netlify builds `dashboard/` from `netlify.toml`, and the skill is installed by a script (no build).

```
sepia/                                # Bun workspace monorepo
├── package.json                      # root scripts (dev, deploy:*)
├── bun.lock                          # ONE lockfile for the whole repo
├── Dockerfile                        # Fly.io entry — installs only the server's deps (--filter)
├── fly.toml                          # scale-to-zero config
├── netlify.toml                      # builds dashboard/, publishes dashboard/build
├── .env.example
├── src/                              # SERVER (deployed by Fly.io)
│   ├── index.ts                      # Bun.serve: mounts /mcp + /api/* + /api/auth/* (CORS)
│   ├── instructions.ts               # The memory contract (system-prompt injection)
│   ├── auth.ts                       # Bearer token (Phase 1) / OAuth guard (Phase 2)
│   ├── oauth.ts                      # OAuth 2.1 authorization server (@tmcp/auth)
│   ├── rate-limit.ts                 # per-user sliding-window rate limits
│   ├── db.ts                         # Drizzle client (lazy init) + MemoryError
│   ├── tools/                        # 7 tools, one file each
│   ├── lib/                          # CRUD + search + BFS + decay (shared by tools & API)
│   └── api.ts                        # /api/* router (same auth as /mcp)
├── drizzle/                          # Drizzle migrations (generated by drizzle-kit)
│   ├── 0000_*.sql                    # baseline (introspected from the live schema)
│   └── 0001_*.sql                    # constraints + trigram indexes (see below)
├── packages/
│   └── shared/                       # @sepia/shared — Valibot schemas + types, no build step
│       ├── src/{schemas,types}.ts    # single source of truth for tools, API, and dashboard
│       └── src/db/                   # Drizzle schema + owner-scoped CRUD libs (plans, users)
├── dashboard/                        # DASHBOARD (deployed by Netlify)
│   └── src/routes/                   # (public)/ landing + pricing, app/ search, memories,
│                                     # entities, conversations, graph, connect, settings
├── skills/
│   └── sepia/                        # SKILL (static, installed by script)
│       ├── SKILL.md
│       ├── always-on/                # per-editor instruction files (vscode, cursor, claude…)
│       └── references/tools.md       # generated from @sepia/shared schemas
├── sql/schema.sql                    # namespaces · entities · relations · memories · oauth_clients
└── scripts/
    ├── install-skill.sh              # copies the skill into every editor dir it finds
    └── gen-skill-ref.ts              # regenerates references/tools.md from shared schemas
```

`@sepia/shared` is imported as TypeScript directly (no build step) by both the server (Bun) and the dashboard (Vite) — the dashboard's forms validate against exactly what the server enforces, and the skill reference is generated from the same schemas: three consumers, one source of truth.

## Getting Started

Prereqs: [Bun](https://bun.sh) 1.x.

```bash
bun install          # one lockfile for the whole workspace

cp .env.example .env # set DATABASE_URL + MCP_BEARER_TOKEN (see below)
bun run dev          # starts the server (MCP on /mcp, REST on /api/*)
bun run dev:dashboard
```

### Environment variables

| Variable             | Purpose                                                                                                                                                                                                        |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`       | Neon Postgres pooled connection string (`-pooler`, port 5432)                                                                                                                                                  |
| `MCP_BEARER_TOKEN`   | Phase 1 auth token for `/mcp` and `/api/*` (`openssl rand -hex 32`)                                                                                                                                            |
| `DASHBOARD_PASSWORD` | OAuth 2.1 consent-page password — setting it **enables** the OAuth endpoints (single user; hosted accounts with plans are in progress). The dashboard itself signs in with the bearer token, not this password |
| `OAUTH_ISSUER_URL`   | OAuth issuer URL (defaults to `https://sepia.fly.dev`; set to `http://localhost:8080` for local dev)                                                                                                           |
| `PUBLIC_API_URL`     | Dashboard build-time REST base (e.g. `https://sepia.fly.dev`)                                                                                                                                                  |
| `PUBLIC_MCP_URL`     | Dashboard build-time MCP URL shown on `/connect`                                                                                                                                                               |

### Database

Single source of truth: `src/db/schema.ts` (Drizzle). No hand-written DDL for new changes.

```bash
bun run db:generate  # schema.ts → new migration in drizzle/
bun run db:migrate   # apply migrations (fresh DB: creates full schema in one go)
bun run db:push      # dev: sync schema.ts diff directly
```

**Existing live DB** (has `sql/schema.sql` but no migration history):

```bash
bun run db:cleanup && bun run db:baseline && bun run db:migrate
# cleanup → repair data, baseline → mark 0000 applied, migrate → 0001 (constraints + pg_trgm)
```

> `db:migrate`/`pull` need `pg` (real TCP + transactions). The app itself uses `@neondatabase/serverless` (HTTP). `sql/schema.sql` is the original baseline — keep it, new changes go through Drizzle.

Schema: `namespaces` → `entities` (cascade, `UNIQUE(namespace_id, name)`) → `relations` (`UNIQUE(source, target, relation_type)`) → `memories` (`importance 0–1`, `archived`) + `memory_entity_links` + `oauth_clients`.

## Deployment

### Server → Fly.io

```bash
fly apps create sepia
fly secrets set DATABASE_URL="postgresql://..." MCP_BEARER_TOKEN="$(openssl rand -hex 32)"
fly deploy
```

- Dockerfile runs `bun install --frozen-lockfile` — SvelteKit never enters the image (all workspace `package.json` files must be copied before install; Bun validates the full workspace graph against the lockfile).
- `fly.toml` uses **scale-to-zero** (`min_machines_running = 0`): the free tier covers it, and cold starts (~1–2s for a thin Bun process) are acceptable for personal use. Set `min_machines_running = 1` (~$1–3/mo) if you want always-on.
- ⚠️ Don't add a Fly HTTP smoke check — raw GETs confuse Streamable HTTP servers. If you want a health endpoint, expose `GET /healthz` with a TCP check.

Verify with `curl -i https://sepia.fly.dev/mcp` (expect 401 without a token — correct) or `npx @modelcontextprotocol/inspector` (Streamable HTTP, `Authorization: Bearer <token>`).

### Dashboard → Netlify

SvelteKit app (SSR + remote functions), built from the repo root (the workspace install must happen at root), published from `dashboard/build`. Attach the `sepia.svelte-apps.me` subdomain, and add the origin to the API's CORS allowlist in `src/index.ts`. Remote functions run in Netlify Functions (Node runtime) and talk to Neon directly via `@sepia/shared` — no CORS, no exposed API keys.

## Connect Clients

### Local editors (Phase 1 — bearer token)

**Claude Code:**

```bash
claude mcp add --transport http sepia https://sepia.fly.dev/mcp \
  --header "Authorization: Bearer YOUR_TOKEN"
```

**Cursor / VS Code Copilot** (`.cursor/mcp.json` / `.vscode/mcp.json`):

```json
{
  "mcpServers": {
    "sepia": {
      "type": "http",
      "url": "https://sepia.fly.dev/mcp",
      "headers": { "Authorization": "Bearer YOUR_TOKEN" }
    }
  }
}
```

**Zed** (Settings → Agent → MCP): same shape as above.

**Older stdio-only clients:** use Fly's shim — `fly mcp proxy https://sepia.fly.dev/mcp` (or `npx mcp-remote --header "Authorization: Bearer ..."`).

### Online AIs (Phase 2 — OAuth 2.1, verified mid-2026)

| AI             | Where                                             | Gate                            |
| -------------- | ------------------------------------------------- | ------------------------------- |
| **Claude**     | Settings → Connectors → custom connector          | Every plan (Free = 1 connector) |
| **Grok**       | grok.com/connectors → New Connector → Custom      | Paid plans                      |
| **ChatGPT**    | Settings → Apps → Developer mode → Create         | Plus+, web only                 |
| **Gemini**     | Settings → Connected Apps → Custom apps for Spark | Google AI Pro/Ultra (Spark)     |
| **Perplexity** | Settings → Connectors → Custom → Remote           | Pro/Max/Enterprise              |
| **Le Chat**    | Connectors → + Add Connector → Custom             | Free/paid                       |

All connect from the **provider's cloud**, so the server must be publicly reachable (it is — Fly with `force_https`); Streamable HTTP is the universal transport.

> ✅ **OAuth 2.1 is live.** Paste the MCP URL into any of these connectors and you'll get a browser sign-in (password = `DASHBOARD_PASSWORD`) instead of a manual credential form. Step-by-step for Grok: [Connecting Sepia to Grok](docs/grok-custom-connector.md). Bearer-token clients (Claude Code, Cursor, Zed, Copilot) keep working unchanged.

### Install the skill + always-on instructions

The skill and the always-on instruction files are served over HTTP from the same
server as the MCP endpoint, so you can install them without cloning the repo:

```bash
# One-liner — fetches SKILL.md + references + always-on files from the server
# and installs into every editor dir it finds:
#   skills:  ~/.agents, .cursor, .claude, .codex, .opencode
#   always-on: VS Code prompts folder, Cursor user rules, ~/.claude/CLAUDE.md, AGENTS.md
curl -fsSL https://sepia.fly.dev/install | bash
```

Or via the [skills.sh](https://skills.sh) CLI (open agent skills ecosystem):

```bash
# From the GitHub repo (discovers skills/sepia/)
npx skills add Michael-Obele/sepia

# Or directly from the server's SKILL.md URL
npx skills add https://sepia.fly.dev/skill
```

If you have the repo cloned, the local installer works too:

```bash
bun run scripts/install-skill.sh   # skill + always-on files, idempotent
```

Restart your editor to pick it up. Claude Code users can also invoke the skill on demand with `/sepia`.

[![skills.sh](https://skills.sh/b/Michael-Obele/sepia)](https://skills.sh/Michael-Obele/sepia)

## Roadmap

| Milestone                                      | Exit criteria                                                                                                                                   |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| M1 — Server on Fly.io, Bearer auth, 7 tools ✅ | Inspector connects; CRUD works end-to-end against Neon                                                                                          |
| M2 — Server instructions + skill ✅            | New chat in Claude Code recalls a memory with zero reminder prompts; skill works in Zed + Cursor; always-on files installed in VS Code + Cursor |
| M3 — REST API + dashboard on Netlify ✅        | Browse/search/graph/CRUD at `sepia.svelte-apps.me`; stats load                                                                                  |
| M4 — OAuth 2.1 (`@tmcp/auth`) ✅               | `codex mcp login` + inspector OAuth flow succeed; Claude connector works                                                                        |
| M5 — Online AI rollout ✅                      | Grok + ChatGPT + Gemini connectors authorized; memory usable from web chats                                                                     |
| M6 — Hosted accounts 🚧                        | Signup/sign-in, per-user namespaces, plan limits, API keys, per-user rate limits — built and smoke-tested, shipping soon                        |

**Release gate:** everything in M1–M3 works in a fresh chat with zero reminder prompts (verified via instructions + always-on files + skill), and the dashboard shows the same data the agents write.

### Future enhancements

- **Semantic search** — pgvector on Neon (paid) or a small embeddings service; `search` is already a single tool, so the engine swaps without schema changes
- **Multi-user namespaces** — per-person namespaces + shared read-only access
- **Memory ingestion API** — browser extension or CLI to dump chat transcripts into memory
- **MCP resources** — expose the graph as `memory://` resources for subscription-capable clients
- **Publishing** — the skill to skills.sh; the server to an MCP marketplace

## Costs

| Item                                        | Cost                                                   |
| ------------------------------------------- | ------------------------------------------------------ |
| Fly.io (shared-cpu 256MB VM, scale-to-zero) | **$0** (free tier)                                     |
| Netlify (dashboard SPA)                     | **$0** (~20–60 of 300 credits/mo)                      |
| Neon Postgres free tier                     | **$0** (0.5 GB, 100 CU-hours — fine for ~10K memories) |
| Domains                                     | $0–12/yr                                               |
| **Total**                                   | **$0/mo** (always-on variant: ~$1–3/mo)                |

## License

[AGPL-3.0](LICENSE) — GNU Affero General Public License v3.0. Copyright © 2026 Michael Obele.

**Self-host free.** You may run, modify, and redistribute Sepia for any purpose — personal or commercial — as long as modified versions offered as a network service publish their source under AGPL-3.0 (section 13).

**Hosted service (optional, paid).** The maintainers run a hosted, multi-account instance of Sepia on shared infrastructure (always-on availability, multiple machines for uptime and speed). Using that hosted service is a separate paid offering that covers the always-on infrastructure cost — the AGPL does not require hosted services to be free. Self-hosting remains free forever.

**Contributions.** By submitting a pull request, you agree that your contributions are licensed under AGPL-3.0-or-later, so the project can keep this license (and dual-license later if needed).

## Security & Privacy

- All traffic TLS (`force_https = true`); secrets live in `fly secrets`, never in the image
- The memory contract forbids storing credentials/secrets — the server is a memory, not a vault
- OAuth consent screen (Phase 2) lists scopes (`memory:read`, `memory:write`)
- `consolidate` purges archived rows; retention rules can be added (e.g. importance < 0.2 and unaccessed 90 days → archive)

## Documentation

The full design lives in `plan/` — implementation specs, decision records, and research with citations:

- [`plan/README.md`](plan/README.md) — master plan: tool behavior spec, DB schema, deploy parts 1–7, milestones
- [`plan/arch.md`](plan/arch.md) — architecture decisions (Bun vs Node, TMCP, Neon, Fly.io, instructions + skill, auth phases)
- [`plan/dashboard.md`](plan/dashboard.md) — web dashboard spec (REST API surface, pages, graph payload, Netlify deploy)
- [`plan/skill.md`](plan/skill.md) — the bundled Agent Skill (full draft + install matrix)
- [`plan/notes.md`](plan/notes.md) — research notes: competition analysis, client compatibility, citations (Aug 2026)

## Status

**M1–M5 shipped.** The server, instructions, skill, dashboard, and OAuth rollout are all live and verified. Hosted accounts (signup, plans, API keys) are built and in final testing — coming soon. PRs, issues, and ideas welcome.
