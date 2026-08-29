# Sepia Dashboard

The web dashboard for [Sepia](https://github.com/Michael-Obele/sepia) — a personal knowledge-graph memory server for AI agents. Browse, search, edit, and visualize your memory from the browser.

Live at [sepia.svelte-apps.me](https://sepia.svelte-apps.me).

## Stack

- **Svelte 5** (runes mode) + SvelteKit
- **Tailwind CSS v4** + shadcn-svelte + Lucide icons
- **runed** — persisted state, URL-backed search params (`useSearchParams` + valibot schemas)
- **`@sepia/shared`** — the same Valibot schemas and owner-scoped DB helpers the server uses
- Deployed to **Netlify** with `adapter-netlify` (SSR + remote functions, Node runtime)

## Development

The dashboard is part of the Sepia Bun workspace — install and run from the repo root:

```bash
bun install
cp .env.example .env   # set DATABASE_URL + AUTH_URL (see below)
bun run dev:dashboard  # http://localhost:5173
```

The dev server needs the Sepia API running locally for auth and data:

```bash
bun run dev            # API on http://localhost:8080 (MCP + REST + auth)
```

### Environment variables

| Variable         | Purpose                                                                               |
| ---------------- | ------------------------------------------------------------------------------------- |
| `DATABASE_URL`   | Neon Postgres connection string (server-side, via `$env/dynamic/private`)             |
| `AUTH_URL`       | Server-side auth base (default `https://sepia.fly.dev`; dev: `http://localhost:8080`) |
| `VITE_AUTH_URL`  | Client-side auth base (dev: `http://localhost:8080`)                                  |
| `PUBLIC_API_URL` | Build-time REST base shown on the Connect page                                        |
| `PUBLIC_MCP_URL` | Build-time MCP URL shown on the Connect page                                          |

## Structure

```
src/routes/
├── (public)/            # landing page + hosted pricing
├── app/                 # the app shell (sidebar)
│   ├── +page.svelte     # search across memories, entities, relations
│   ├── memories/        # browse/filter memories (URL-backed filters)
│   ├── entities/        # entities + relations CRUD
│   ├── conversations/   # handoff digests (active/paused/done)
│   ├── graph/           # interactive knowledge-graph view
│   ├── connect/         # "Connect an AI" setup wizard
│   ├── settings/        # namespaces + consolidation
│   └── account/         # plan, usage, API keys
└── signup/              # create an account
```

## Data layer

- `src/lib/remote/*.remote.ts` — SvelteKit **remote functions**: type-safe client↔server calls that run in Netlify Functions and talk to Neon via `@sepia/shared` (no CORS, no exposed API keys)
- `src/lib/server/db.ts` — Drizzle client wired to `$env/dynamic/private`
- `src/lib/auth-client.ts` — Better Auth client (email/password sessions)

## Deploy

Netlify builds from the repo root (`netlify.toml`): installs the workspace, builds the dashboard, publishes `dashboard/build`. Attach the `sepia.svelte-apps.me` subdomain and add the origin to the API's CORS allowlist in `src/index.ts`.
