Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";
import { createRoot } from "react-dom/client";

// import .css files directly and it works
import './index.css';

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.

## Dev servers & builds — ASK FIRST

Do NOT start new dev servers (vite, `bun run dev`, `bun --hot`, etc.) and do NOT run builds/deploys on your own initiative. The user always has dev servers running on specific ports. Ask the user which server/port the dev environment is running on, then use it (e.g. for browser preview). If you think a build or deploy is needed, ask first — the user knows the setup.

## Sepia docs — keep in sync when adding features

Sepia's docs are the agents' only window into the server. When you add a feature (new tool, action, field, endpoint, or behavior change), update ALL of these before calling it done:

1. `src/instructions.ts` (MEMORY_CONTRACT) — the MCP `instructions` field, injected fresh every session. THE source of truth.
2. `skills/sepia/SKILL.md` — the on-demand agent skill.
3. `skills/sepia/always-on/*` (vscode, claude, cursor, agents, opencode, zed) — always-on essentials. Keep them minimal + stable: new depth goes in llms.txt / SKILL.md, not here.
4. `llms.txt` — full capability overview, served at /llms.txt. What agents fetch when they need the whole surface.
5. `scripts/gen-skill-ref.ts` — run `bun run scripts/gen-skill-ref.ts` to regenerate `skills/sepia/references/tools.md` from the schemas.
6. `scripts/smoke.ts` — cover the new surface (a feature without a smoke check is untested).
7. Version — bump `DOCS_VERSION` in `packages/shared/src/types.ts`, then run `bun run scripts/stamp-docs-version.ts`. It stamps that ONE version into every agent-facing file, in whichever form the file exposes it: the `sepia-docs-version` HTML comment, `llms.txt`'s `Docs version:` line, and the `version:` YAML **frontmatter** of `SKILL.md` / `vscode` / `cursor`. Which files carry which markers is declared once in `scripts/docs-manifest.ts` — shared by the stamp, the checker and smoke, so a file cannot be stamped without also being checked. Then prove it: `bun run scripts/check-docs-version.ts --source-only`. (Never put a marker on a line of its own outside a real marker — the stamp rewrites every marker line it finds. One quoted mid-sentence is safe.)
8. Installed copies — run `bash scripts/install-skill.sh` (block-marker sections update in place, never duplicate). It reports the version it wrote for every file and aborts if a copy did not land at the source version — but it reads the FIRST marker in the file, so a full marker audit (missing, disagreeing, stale) is `check-docs-version.ts`'s job, not the installer's.
9. Deploy — `fly deploy` so the served versions (/version, /llms.txt, /skill, /instructions/\*, MCP instructions) update for everyone.
10. Check — `bun run scripts/check-docs-version.ts` after deploy. It checks both halves (repo markers vs `DOCS_VERSION`, installed copies vs the served version) and fails on a file whose markers DISAGREE — not just on one that is old. `--source-only` skips the network; `docs.yml` runs that half (plus the marker/policy unit tests) on every docs or scripts path, including `packages/shared/src/types.ts` where `DOCS_VERSION` lives. `docs.yml` is the ONLY workflow that gates on docs — a publish is never blocked by a doc problem.

**THERE IS NO "OWN VERSION".** A `version:` in a frontmatter IS `DOCS_VERSION` — no skill/instruction system reads or bumps it. It used to be hand-written and left out of the stamp, so it froze at `1.0.0` while every body marker moved on: VS Code, Cursor and the skill advertised 1.0.0 for months, and `check-docs-version.ts` reported "all current" because it read only the first marker it found. Never hand-edit a version marker — stamp it, and never reintroduce a second version concept.

**EVERY VERSION IS DERIVED, NEVER TYPED.** Three artifacts, three real sources — none of them a literal someone must remember to bump:

- the agent-facing docs → `DOCS_VERSION`, stamped into every file's markers;
- the **deployed server** → its Fly deploy name (`src/version.ts`, from `FLY_IMAGE_REF`/`FLY_MACHINE_VERSION`), because a continuously-deployed app has no semver to report; locally it reads `dev`;
- the **`sepia-mcp` npm package** → its own `package.json` version, which Changesets maintains.

`src/index.ts` used to advertise `version: "1.0.0"` in `serverInfo` and the `/` and `/version` payloads — for months — because the MCP spec requires the field and nobody owned the value. That is what a hand-typed version buys you: a lie with a delay.

Rule: no feature is done until its docs are updated. Check the diff of every always-on file before committing.

<!-- sepia:start -->

## Sepia memory (always-on) — AGENTS.md (Codex / OpenCode / generic)

<!-- sepia-docs-version: 1.10.0 -->

You are connected to the user's personal Sepia memory server (sepia) over MCP (any `AGENTS.md`-aware agent: Codex, OpenCode, Copilot, Cursor, Zed). It stores a knowledge graph in namespaces (default `personal`): entities, relations, memories with importance scoring.

> **MANDATORY — ALMOST EVERY MESSAGE:** This file is auto-loaded in every session by all `AGENTS.md` clients. **Default to using Sepia on every turn** — `search` BEFORE you answer and persist AFTER you answer. Only skip for trivial chitchat ("hi", "thanks", "bye") with zero durable content. If in doubt, call Sepia. Skipping memory = hallucinating.

### Workflow — do this on ALMOST EVERY turn

**FIRST — once per session, before your first substantive action:**

0. Call `manage_memory` with `action: "briefing"` — the user's **core standing rules** (everything tagged `always`, plus every instruction/preference at importance >= 0.9). No keywords: a standing constraint cannot be found by keyword search, which is exactly why this read is unconditional. Treat what it returns as binding for the whole session. It also reports `other_standing` — the situational rules it did NOT return. **Before anything slow, metered, destructive, or expensive** (an install, build, deploy, deletion, or infra change), call it again with `detail: "all"`: the rule that bites in those moments is exactly the one a default load leaves out. **~1M-token context window?** Make that FIRST call with `detail: "all"` (and `max_chars` at its maximum) instead — the whole standing set is ~10k tokens (≈1% of your window), read once per session, priority-ordered with core first; core-by-default protects small contexts, it does not withhold rules from big ones. If you don't know your window size, keep the default.

**BEFORE you answer (every turn except trivial chitchat):**

1. Call `search` with 2-5 keywords from the user's current message + task (e.g. `search query="auth rate limiting"`). If sparse, also call `traverse_graph` from the top entity.
2. Weave hits into your answer (`From your memory: ...`). If nothing, say so — never fabricate.

**AFTER you answer (every turn where you learned something):**

1. If you learned a durable fact — preference, decision + why, project fact, stack/tool choice, person/role, convention, user correction — persist IMMEDIATELY in the same turn after your response:
   - `manage_entity` find → create (with `summary`) if missing
   - `manage_memory` create (`content`, `type`, `importance`, `entity_ids` 1-3)
   - `manage_relation` to link graph (`project —uses→ tool`)
2. **A constraint is always worth storing — including a complaint.** A stated preference, a correction, or an objection to how you just worked is a durable rule: store it in the **same turn**, `instruction` for behaviour / `preference` for a choice, importance >= 0.8, tagged `always` when it applies everywhere. Storing it a turn later is too late.
3. Prefer update over duplicate — search first, then `action=update`.
4. **Importance 0-1:** 0.9+ identity/core pref, 0.6-0.8 project fact/decision, 0.3-0.5 observation, ≤0.2 transient.
5. **Never store:** ephemeral chat, code snippets, credentials/secrets.
6. **Never call `prune_memories`** unless the user explicitly asks — it is a destructive maintenance sweep (archives stale, purges archived), NOT a way to save. Saving is `manage_memory`.

> Rule of thumb: If the user sent a message with any substantive content, you should have called `search` before replying and considered a `manage_memory`/`manage_entity` write after replying. Two Sepia calls per turn is normal and expected.

### "Save to memory" → Sepia (not editor memory)

When the user says **"save to memory"**, **"remember this"**, **"save this"**, **"remember that"**, **"save this for later"**, or any variant — ALWAYS write to **Sepia** (`manage_memory` + `manage_entity` if needed), NOT just the editor's built-in memory. Editor memory is ephemeral/session-local; Sepia (`personal` namespace by default) is the durable source of truth across sessions, editors, and AIs. Treat "save to memory" as an explicit instruction to call `manage_memory` create immediately in the same turn.

### Conversation migration (handoff digests)

When the user says **"save this conversation"**, **"hand off to another AI"**, **"migrate my context"**, or switches assistants mid-task, use `manage_memory` action=ingest with a `conversation` payload. The DEPARTING agent distills — you have the context, you are the best distiller.

- Payload: `summary` (≤4000, structured markdown), `conversation_id` (groups digests of one conversation), `title` (human-readable — how you tell them apart), `status` (active|paused|done), `decisions`/`preferences`/`instructions`/`observations`/`open_questions` (keep evidence VERBATIM — exact errors, paths, IDs), `entities` (find-or-create), `source` {ai, ref}, optional `transcript` (only if the raw log exists).
- The server atomically creates: digest (tag `conversation`, importance 0.85, protected from consolidation) + typed constituents + entities. One digest per major topic, same `conversation_id` groups them.
- **Resume**: `search` q="" tags=["conversation"] → prefer status=active → read the digest → pull constituents via `query` tags (decision, open-question, …).
- **Mark done**: `manage_memory` action=update on the digest with `metadata: {...existing, status: "done"}` (metadata REPLACES — get first, then merge).

This file has the essentials; for full tool schemas and examples, load the `sepia` skill (`SKILL.md`) if available. For the full capability overview (all 7 tools, conversation migration, REST API), fetch https://sepia.fly.dev/llms.txt. Project `AGENTS.md` stacks with `~/.config/opencode/AGENTS.md` and `~/.codex/AGENTS.md`. See also `src/instructions.ts` (source of truth).

<!-- Source of truth: src/instructions.ts (MEMORY_CONTRACT). Keep in sync. -->
<!-- sepia:end -->
