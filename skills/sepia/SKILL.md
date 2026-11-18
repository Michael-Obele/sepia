---
version: "1.16.1"
name: sepia
description: >-
  Use when the assistant should recall or persist long-term knowledge about the
  user, their projects, preferences, decisions, people, conventions, or stack —
  across sessions and tools. Triggers: "remember that", "what do we know about",
  "recall", "save this for later", "do you remember", learning a durable fact, or
  any request where context from a past session would change the answer. Not for
  ephemeral chat or code snippets.
---

# Sepia

The user's memory server over MCP: a knowledge graph in **namespaces**, holding
**entities**, **relations** and **memories**. Their shape is the next section.

## Types & tags

- **Entity type** — `person` | `project` | `tool` | `concept` | `repo`. An unknown
  type is normalised to `concept` plus a tag.
- **Memory type** — `fact` (verified or decided) | `observation` (what you saw) |
  `preference` (stated or observed choice) | `instruction` (how to behave).
- **Tags** — short lowercase hyphenated labels, 1–4 per write. `always` is
  reserved; see below.

## Once per session, before any work

1. `wake` — retry up to 3×, a few seconds apart. The host sleeps when idle, so a
   failure means you called during boot, not that memory is down.
2. `manage_memory action="briefing"` — the user's standing rules. No keywords: a
   rule you have not guessed cannot be found by search, which is the entire reason
   this read is unconditional. Treat it as binding for the session.

Neither repeats on later messages in the same chat. Before anything slow, metered,
destructive or expensive, repeat the briefing with `detail="all"` — the rule that
bites in those moments is exactly the one a default load leaves out. Why the
split works, and the measured cost of compressing it: `references/standing-rules.md`.

## Scope every call to the project

**One namespace per project, named by repo slug.** This is the difference between
a memory store you can follow and a pile you cannot.

1. **Resolve once:** `manage_namespace action="ensure" name="<repo-slug>"`. It is
   get-or-create, so "already exists" is never an error to recover from.
   `action="list"` shows every namespace with its counts if you need to check.
2. **Pass `namespace` on every call** — memories, entities, relations, briefing,
   query. A write with no namespace lands in `personal`, which is the one mistake
   that rebuilds the noise scoping exists to remove.
3. **`personal` is the cross-project bucket.** Genuine cross-project knowledge, and
   anything universal, lives there.
4. **Tag `always` only when a rule applies in every repo and session.** Tagged rules
   load in every namespace; project-scoped rules must not carry it, or they become
   noise everywhere else.
5. **Free plan = one namespace.** If `ensure` or `create` returns `plan_limit`,
   continue in `personal`, do not retry, and do not push an upgrade mid-task.

Full rules, plan limits and how to refile a misfiled memory:
`references/namespaces.md`.

## Every turn — recall

Call `search` with 2–5 keywords from the request **before** you answer. Skip only
for trivial chitchat. If it returns nothing, or `partial: true`, retry with ONE
distinctive word before you conclude nothing exists — then say so. Never fabricate
a memory. Cite what came from memory when it matters ("From your memory: ...").

If search is thin, `manage_relation action="traverse"` from the best entity pulls
its neighbourhood.

**Diagnostic:** *identical* results for different `q` values means the filter was
NOT applied — check `filters_applied` / `ignored_args` before blaming ranking.

## Every turn — persist

After answering, if you learned something durable, store it **in the same turn**:

- A preference, a decision and its reason, a project fact, a person's role, a
  convention, a tool or stack choice, a correction.
- **A correction, a complaint, or an objection to how you just worked is a rule,
  not chatter.** Store it immediately as `instruction` (how to behave) or
  `preference` (a choice), importance ≥ 0.8. Storing it a turn later is too late —
  the rule exists for the turn in which you did not yet know it.
- Order: `manage_entity` find → create if missing → `manage_memory` create with
  `namespace` and 1–3 `entity_ids` → `manage_relation` to wire the graph.
- **Search first, then `action=update`.** Never write a duplicate.
- Importance: 0.9+ identity and non-negotiables · 0.6–0.8 active project facts ·
  0.3–0.5 observations and people · ≤0.2 transient.
- Never store ephemeral chat, code snippets, credentials or secrets.

## "Save this" means Sepia

When the user says **"save to memory"**, **"remember this"**, **"save this"** or
any variant, write to Sepia in that same turn — not the editor's built-in memory,
which is session-local. Sepia is the durable source of truth across sessions,
editors and AIs. `manage_memory action="ingest"` covers a whole conversation
handoff; see `references/conversations.md`.

## Load on demand

| Need | Load |
| --- | --- |
| Exact tool args, action enums, example calls | `references/tools.md` |
| Per-project scopes, plan limits, refiling | `references/namespaces.md` |
| Why core is `always`-tagged, briefing budget, escalation | `references/standing-rules.md` |
| Conversation handoff and resume | `references/conversations.md` |
| Search returned nonsense, args ignored, conflicting facts | `references/troubleshooting.md` |

## Never

`prune_memories` is the only destructive tool. Never call it to save anything, and
never proactively — only when the user explicitly asks to prune.

Never write another **account's** identifier into a memory: diagnostic and audit
output belongs in the repo. The store masks foreign account addresses and reports
`redacted_accounts`. Namespaces do not help — they separate projects inside one
account, and that account's search reads across all of them.
