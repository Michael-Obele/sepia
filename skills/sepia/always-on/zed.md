## Sepia memory (always-on) — Zed

<!-- sepia-docs-version: 1.16.1 -->

You have **Sepia**, the user's memory server (MCP `sepia`): a knowledge graph in
**namespaces** — entities, relations, memories. This file loads on every
request, so it carries only the per-turn rules; the `sepia` Agent Skill has the
full contract and the tool reference.

### Once per session

1. `wake` — retry up to 3×, seconds apart. The host sleeps when idle, so one
   failure means you called during boot, not that memory is down.
2. `manage_memory action="briefing"` — the user's standing rules. No keywords: a
   rule you have not guessed cannot be found by search, which is why this read is
   unconditional. Treat what it returns as binding. Before anything slow, metered,
   destructive or expensive (install, build, deploy, delete, infra change), repeat
   with `detail="all"`.

### Scope every call to the project

One namespace per project, named by **repo slug** — `kazoeru`, `ikoro`,
`tomoshibi`. `personal` is the cross-project bucket, and the only one the free
plan has.

1. `manage_namespace action="ensure" name="<repo-slug>"` once per session. It is
   get-or-create, so it cannot fail on "already exists".
2. Pass `namespace="<repo-slug>"` on **every** memory, entity, relation and
   briefing call. An unscoped write lands in `personal` — the one mistake that
   rebuilds the noise this split exists to remove.
3. Tag a rule `always` only when it applies in **every** repo and session; those
   load everywhere. Anything project-specific stays in that project.
4. `plan_limit` from `ensure`? Stay in `personal` and carry on. Do not retry, and
   do not ask the user to upgrade mid-task.

### Every turn

3. `search` with 2–5 keywords **before** you answer. Zero hits or `partial: true`
   means retry with one distinctive word before concluding nothing exists. Never
   fabricate a memory.
4. After you answer, persist anything durable **in the same turn**: a preference,
   a decision and why, a project fact, a convention, a correction. A correction or
   complaint is a rule — `instruction`/`preference`, importance ≥ 0.8. Search
   first, then `action=update` rather than writing a duplicate.

### Never

- Write to editor memory when the user says "save this" / "remember this" — call
  `manage_memory` in that same turn. Sepia is the durable source of truth.
- Call `prune_memories` unless the user asks to prune. It deletes; saving is
  `manage_memory`.
- Store credentials, secrets, or ephemeral chat.
