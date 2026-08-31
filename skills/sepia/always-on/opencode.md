## Sepia memory (always-on) — OpenCode

<!-- sepia-docs-version: 1.2.0 -->

You are connected to the user's personal Sepia memory server over MCP (`sepia` remote at `https://sepia.fly.dev/mcp`). Model: `sepia` in `opencode.json` (`type: "remote"`, `headers.Authorization: "Bearer TOKEN"`). It stores a knowledge graph in namespaces (default `personal`): entities, relations, memories with importance scoring.

> **MANDATORY for OpenCode — ALMOST EVERY MESSAGE:** Sepia is your first tool. OpenCode sessions are short — without `search` you lose 100% of cross-session context. **Default to using Sepia on every turn** — `search` BEFORE you answer and persist AFTER you answer. Only skip for trivial chitchat ("hi", "thanks", "bye") with zero durable content. If in doubt, call Sepia. Skipping memory = hallucinating.

### Workflow — do this on ALMOST EVERY turn

**BEFORE you answer (every turn except trivial chitchat):**

1. Call `search` with 2-5 keywords from the user's current message + task (e.g. `search query="auth rate limiting"`). If sparse, also call `traverse_graph` from the top entity.
2. Weave hits into your answer (`From your memory: ...`). If nothing, say so — never fabricate.

**AFTER you answer (every turn where you learned something):**

1. If you learned a durable fact — preference, decision + why, project fact, stack/tool choice, person/role, convention, user correction — persist IMMEDIATELY in the same turn after your response:
   - `manage_entity` find → create (with `summary`) if missing
   - `manage_memory` create (`content`, `type`, `importance`, `entity_ids` 1-3)
   - `manage_relation` to link graph (`project —uses→ tool`)
2. Prefer update over duplicate — search first, then `action=update`.
3. **Importance 0-1:** 0.9+ identity/core pref, 0.6-0.8 project fact/decision, 0.3-0.5 observation, ≤0.2 transient.
4. **Never store:** ephemeral chat, code snippets, credentials/secrets.

> Rule of thumb: If the user sent a message with any substantive content, you should have called `search` before replying and considered a `manage_memory`/`manage_entity` write after replying. Two Sepia calls per turn is normal and expected.

### "Save to memory" → Sepia (not editor memory)

When the user says **"save to memory"**, **"remember this"**, **"save this"**, **"remember that"**, **"save this for later"**, or any variant — ALWAYS write to **Sepia** (`manage_memory` + `manage_entity` if needed), NOT just the editor's built-in memory. Editor memory is ephemeral/session-local; Sepia (`personal` namespace by default) is the durable source of truth across sessions, editors, and AIs. Treat "save to memory" as an explicit instruction to call `manage_memory` create immediately in the same turn.

### Conversation migration (handoff digests)

When the user says **"save this conversation"**, **"hand off to another AI"**, **"migrate my context"**, or switches assistants mid-task, use `manage_memory` action=ingest with a `conversation` payload. The DEPARTING agent distills — you have the context, you are the best distiller.

- Payload: `summary` (≤4000, structured markdown), `conversation_id` (groups digests of one conversation), `title` (human-readable — how you tell them apart), `status` (active|paused|done), `decisions`/`preferences`/`instructions`/`observations`/`open_questions` (keep evidence VERBATIM — exact errors, paths, IDs), `entities` (find-or-create), `source` {ai, ref}, optional `transcript` (only if the raw log exists).
- The server atomically creates: digest (tag `conversation`, importance 0.85, protected from consolidation) + typed constituents + entities. One digest per major topic, same `conversation_id` groups them.
- **Resume**: `search` q="" tags=["conversation"] → prefer status=active → read the digest → pull constituents via `query` tags (decision, open-question, …).
- **Mark done**: `manage_memory` action=update on the digest with `metadata: {...existing, status: "done"}` (metadata REPLACES — get first, then merge).

This file has the essentials; for full tool schemas and examples, load the `sepia` skill (`SKILL.md`) if available. For the full capability overview (all 7 tools, conversation migration, REST API), fetch https://sepia.fly.dev/llms.txt. See also `src/instructions.ts` (source of truth).

<!-- Source of truth: src/instructions.ts (MEMORY_CONTRACT). Keep in sync. -->
