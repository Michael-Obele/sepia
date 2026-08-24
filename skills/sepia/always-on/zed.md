## Sepia memory (always-on) — Zed

You are connected to the user's personal Sepia memory server over MCP (`context_servers.sepia` in `~/.config/zed/settings.json`: `url: "https://sepia.fly.dev/mcp"` + `headers.Authorization: "Bearer TOKEN"`; or stdio bridge via `mcp-remote`). It stores a knowledge graph in namespaces (default `personal`): entities, relations, memories with importance scoring.

> **MANDATORY for Zed:** Zed's Agent Panel does not auto-recall — you must `search` yourself. Treat the first tool call of every task as `search`. No search = guessing.

### Workflow (do this every session)

1. **BEFORE meaningful work** — `search` with 2-5 keywords from the task (e.g. `search query="auth rate limiting"`). If sparse, `traverse_graph` from the top entity. Weave hits into your answer (`From your memory: ...`). If nothing, say so — never fabricate.
2. **WHEN you learn a durable fact** (preference, decision+why, project fact, tool/stack, person, convention) — persist NOW:
   - `manage_entity` find → create (with `summary`) if missing
   - `manage_memory` create (`content`, `type`, `importance`, `entity_ids` 1-3)
   - `manage_relation` to link graph (`project —uses→ tool`)
3. **Prefer update** over duplicate — search first, then `action=update`.
4. **Importance 0-1:** 0.9+ identity/core pref, 0.6-0.8 project fact/decision, 0.3-0.5 observation, ≤0.2 transient.
5. **Never store:** ephemeral chat, code snippets, credentials/secrets.

### Conversation migration (handoff digests)

When the user says **"save this conversation"**, **"hand off to another AI"**, **"migrate my context"**, or switches assistants mid-task, use `manage_memory` action=ingest with a `conversation` payload. The DEPARTING agent distills — you have the context, you are the best distiller.

- Payload: `summary` (≤4000, structured markdown), `conversation_id` (groups digests of one conversation), `title` (human-readable — how you tell them apart), `status` (active|paused|done), `decisions`/`preferences`/`instructions`/`observations`/`open_questions` (keep evidence VERBATIM — exact errors, paths, IDs), `entities` (find-or-create), `source` {ai, ref}, optional `transcript` (only if the raw log exists).
- The server atomically creates: digest (tag `conversation`, importance 0.85, protected from consolidation) + typed constituents + entities. One digest per major topic, same `conversation_id` groups them.
- **Resume**: `search` q="" tags=["conversation"] → prefer status=active → read the digest → pull constituents via `query` tags (decision, open-question, …).
- **Mark done**: `manage_memory` action=update on the digest with `metadata: {...existing, status: "done"}` (metadata REPLACES — get first, then merge).

This file has the essentials; for full tool schemas and examples, load the `sepia` skill (`SKILL.md`) if available. See also `src/instructions.ts` (source of truth).

<!-- Source of truth: src/instructions.ts (MEMORY_CONTRACT). Keep in sync. -->
