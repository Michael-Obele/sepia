---
version: "1.0.0"
name: sepia
description: >-
  Use when the user's AI assistant should recall or persist long-term knowledge
  about the user, their projects, preferences, decisions, people, conventions,
  or technical stack — across sessions and across tools. Triggers: starting
  meaningful work ("remember that", "what do we know about", "recall", "save
  this for later", "do you remember"), learning durable facts, or when context
  from past sessions would change the answer. Do NOT use for ephemeral chat
  content or code snippets.
---

# Sepia (remote knowledge-graph memory server)

You are connected to the user's personal memory server over MCP
(https://sepia.fly.dev/mcp). It stores a knowledge graph in namespaces
(default `personal`): **entities** (nodes: people, projects, tools, concepts,
repos), **relations** (directed edges), **memories** (facts/observations/
preferences/instructions with importance scores).

## Types & tags (use the canonical values)

- **Entity type** (`manage_entity`): `person` | `project` | `tool` | `concept` |
  `repo`. Unknown types are auto-normalized to `concept` + tag.
- **Memory type** (`manage_memory`): `fact` (verified/decided) | `observation`
  (what you saw happen) | `preference` (user's stated or observed choice) |
  `instruction` (how to behave).
- **Tags** (both): short lowercase hyphenated topical labels
  (e.g. `user-experience`, `auth`, `performance`) — add 1-4 per write when the
  topic is recurring. Search and query can filter by tags.

## Standing rules — read FIRST, once per session

Some memories are **standing rules**: how the user wants you to behave, everywhere. They are
the rules you do not yet know you need — and that is exactly why keyword search cannot find
them. Relevance is measured against a task you have not scoped yet, so a rule whose existence
you have not guessed is unsearchable by construction.

So this one read is **unconditional**. Before your first substantive action in a session,
call `manage_memory` with `action: "briefing"`. No keywords.

- **Core** = every memory tagged `always` **or** at importance >= 0.9. The importance half
  means it works on rules stored before this feature existed — there is no tagging migration.
- **It returns core by default, and that split is the design.** Core is a handful of rules and
  stays small — safe to load every session forever. The tail (situational, project-scoped)
  grows without bound (measured: 9 core rules ≈ 886 tokens against 235 tail rules ≈ 8.5k), and
  a long constraint list is self-defeating, because the rules that matter stop standing out.
  The response reports `other_standing`, so a caller always knows the tail is there.
- Each rule is compacted to 400 chars (full text stays reachable via `action: "get"` on the
  `id`). **400 is a measured floor, not an arbitrary one**: against the real core set, cutting
  to 200 chars strips the actionable clause from 2 of 9 rules, and first-sentence extraction
  strips it from 5 of 9 — including "state the download size before any build", whose first
  sentence is pure context. Do not compress a standing rule to save tokens; its power is its
  specificity, and a paraphrase keeps the sentiment while losing the trigger.
- **Core rules are never dropped for budget**, in either mode.
- **Escalation**: before anything slow, metered, destructive, or expensive (install, build,
  deploy, deletion, infra change), call again with `detail: "all"` — and raise `max_chars`
  (default 8000, max 40000) if that reports `truncated: true`.
Tag a rule `always` only when it applies in **every** repo and **every** session. A rule that
is specific to one project must not carry the tag, or it becomes noise in every other session.

## When to recall (READ) — ALMOST EVERY MESSAGE

Default to `search` on every turn — only skip for trivial chitchat ("hi", "thanks", "bye") with zero durable content. If in doubt, search.

1. **First, once per session**: the standing-rules briefing above — deliberately _not_
   keyword-driven, because that is the whole point of it.
2. **Before you answer** (every turn except trivial chitchat), call `search` with 2-5 keywords from the user's current message + task (e.g. `search` query="rate limiting" namespace="personal").
3. If results are sparse, also `traverse_graph` from the most relevant entity to pull its neighborhood.
4. Weave recalled facts into your answer naturally. Cite what came from memory when it matters ("From your memory: ...").
5. Search is **best-effort**: rows matching MORE of your words rank first, so it never returns 0 just because one word is absent. If it returns 0 hits, or the result says `partial: true`, retry with ONE distinctive keyword (or drop filters) BEFORE concluding nothing exists — then say so. Never fabricate memories.

> Two Sepia calls per turn is normal and expected: `search` before you answer, persist after you answer.

## When to write (WRITE) — ALMOST EVERY MESSAGE

Persist in the same turn after your response when you learned something durable and reusable:

- Preferences ("prefers tabs over spaces", "wants PRs under 400 lines")
- Decisions and their rationale ("chose Neon over Supabase because...")
- Project facts ("mcp-showcase deploys via Vercel")
- People and roles, tools and stacks, conventions and constraints
- User corrections ("actually we use pnpm, not npm")

**A constraint is always worth storing — including a complaint.** When the user states a
preference, corrects you, or objects to how you just worked, that is a durable rule, not
chatter: store it in the **same turn**, as `instruction` (how to behave) or `preference` (a
choice), at importance >= 0.8. Tag it `always` when it applies in every repo and every session
— that is what makes it load at the start of the next one. Storing it a turn later is too
late; the rule exists precisely for the turn in which you did not yet know you needed it.

Do **not** store: ephemeral chat content, code snippets, credentials, secrets, or anything transient.

### "Save to memory" → Sepia (not editor memory)

When the user says **"save to memory"**, **"remember this"**, **"save this"**, **"remember that"**, **"save this for later"**, or any variant — ALWAYS write to **Sepia** (`manage_memory` + `manage_entity` if needed), NOT just the editor's built-in memory. Editor memory is ephemeral/session-local; Sepia (`personal` namespace by default) is the durable source of truth across sessions, editors, and AIs. Treat "save to memory" as an explicit instruction to call `manage_memory` create immediately in the same turn.

## How to write

1. **Search first, update second** — avoid duplicates. If a matching
   entity/memory exists, `manage_entity` action=update or `manage_memory`
   action=update it.
2. **Entities before memories**: ensure the entity exists (`manage_entity`
   action=find, else action=create with a short `summary`).
3. **Link memories to entities** via `manage_memory` action=create's
   `entity_ids` field (1-3 entities max; prefer the most specific).
4. **Connect the graph** with `manage_relation` (e.g. `project` →`uses`→
   `tool`, `user` →`prefers`→ `thing`). One relation per directed pair.
5. **Mass edits**: to fix many rows at once (reclassify types, add tags), use
   `manage_entity`/`manage_memory` action=batch_update with a `where` filter
   (type, namespace, query/q, tags) + `update` — returns the count changed.
6. **Importance scoring** (0-1):
   - 0.9+: identity, core preferences, non-negotiables
   - 0.6-0.8: active project facts, decisions, conventions
   - 0.3-0.5: normal observations, people
   - <= 0.2: transient details (will decay first)
7. **Namespaces**: default `personal`. Only create a new namespace if the user
   asks for separation (e.g. `work` vs `personal`).

## Conversation migration (handoff digests)

When the user says **"save this conversation"**, **"hand off to another AI"**,
**"migrate my context"**, or is switching assistants mid-task, use
`manage_memory` action=ingest with a `conversation` payload. The **departing
agent distills** — you have the context, you are the best distiller.

The server atomically saves a bundle: a **digest** (entry point, auto-tagged
`conversation`, importance 0.85, protected from consolidation) + **constituent
memories** (the evidence) + **entities** (find-or-create).

Rules:

1. **One digest per major topic**, all grouped by the same `conversation_id`.
   Multiple digests = one conversation. Search `q=""` + `tags=["conversation"]`
   lists them all.
2. **Always give a human-readable `title`** (e.g. "Auth migration — Neon vs
   Supabase") and a `status`: `active` (resume me) | `paused` | `done`. This is
   how conversations are told apart when resuming — never skip it.
3. **`summary` ≤4000 chars** — context, decisions, open questions, pointers.
   Anti-dump: if it doesn't fit, split into more digests — never pad.
4. **Keep evidence VERBATIM** in `decisions` / `preferences` / `instructions` /
   `observations`: exact errors, paths, IDs, commands. Never soften them.
5. **`transcript` is optional** — only if the raw log actually exists (online
   chat models may not expose one). `source.ref` (session path or share URL)
   is the primary fidelity pointer.
6. **`open_questions`** become observation memories tagged `open-question` —
   the next agent's starting point.

When the user says **"load my context"** / **"continue from my last
conversation"** / **"what did we do last session"**: `search` with
`q=""` + `tags=["conversation"]` first, read the digest, then pull
constituents via `query` (tags) or the digest's entity links.

**Resume flow**: prefer the digest with `status=active` (or the most recent).
When a conversation is finished, update its digest `metadata.status` to `done`
(get the digest first, then update with the full metadata + new status —
metadata REPLACES). When resuming a paused one, set it back to `active`.

## Maintenance — almost never

`prune_memories` is the only destructive tool: it archives stale memories
(importance < 0.3, untouched 90 days), de-duplicates identical content, and
permanently deletes rows archived more than 30 days ago. It requires
`confirm: true`.

- **Never call it to save, remember, or persist anything** — that is
  `manage_memory`. This is the tool that _deletes_ memories.
- **Never call it proactively** or to "tidy up". Only when the user explicitly
  asks to prune or clean up.
- Conversation digests (`metadata.kind = "conversation"`) are exempt from stale
  archiving.

## Examples

- User says "we went with Bun for the server because cold start matters"
  → `manage_entity` find/create `Bun` (type=tool, summary="JS runtime");
  `manage_memory` create content="chose Bun over Node for cold start" type=decision
  importance=0.7 entity_ids=[bun-entity-id]
- User asks "what do we know about the memory server plan?"
  → `search` query="memory server" → read top memories/entities → answer
  with recalled facts, then `traverse_graph` if the user wants the full picture.

## Edge cases

- **Duplicate write**: always search before create; if unsure, update the
  existing item and mention the merge in your reply.
- **Conflicting facts**: create the new memory with importance equal to the old
  one, note the conflict in your reply, and let `prune_memories` handle decay.
- **Sensitive data**: refuse to store credentials/secrets; tell the user the
  memory server is not a vault.
- **Wrong namespace**: if the user is clearly working in `work` context but no
  such namespace exists, ask before creating it.

## Reference

For full tool schemas and action enums, see [references/tools.md](./references/tools.md).
