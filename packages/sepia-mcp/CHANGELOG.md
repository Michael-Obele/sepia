# sepia-mcp

## 0.5.0

### Minor Changes

- c5982c8: `manage_memory` gains `action: "briefing"` — the unconditional session-start read of the
  user's **standing rules**.

  Some memories are standing rules: how the user wants the agent to behave, everywhere. They
  are exactly the rules an agent does not yet know it needs, which is why keyword search cannot
  find them — relevance is measured against a task that has not been scoped yet. `briefing`
  therefore takes no keywords, and is meant to be called once per session, before any work.

  - **Core** = every memory tagged `always`, plus every `instruction`/`preference` at importance
    > = 0.9. The importance half means the guarantee holds for rules stored before this change —
    > there is no tagging migration. A `fact`/`observation` carrying the `always` tag is included
    > too, since the tag is explicit user intent and outranks the type filter.
  - Returns `{ count, core_count, truncated, omitted, max_chars, memories }`, priority-ordered
    (core first, then importance DESC, then recency).
  - Each rule is compacted to 400 chars — the `id` is retained, so the full text stays one
    `action: "get"` away — inside a character budget: `max_chars`, default 8000, max 40000.
  - **Core rules are never dropped for budget**, and `truncated` plus an exact `omitted` (from a
    `COUNT` over the same filter) state what was left out. Silent truncation was the failure this
    path exists to remove, so it never returns a subset it does not declare.
  - REST: `GET /api/memories/briefing?namespace=&max_chars=`, routed above `/api/memories/:id`
    (that `/:id` matcher would otherwise swallow `briefing` and reject it as a non-uuid).

  The write contract is strengthened to match: a user constraint, a correction, or a complaint
  about how the agent just worked is a durable rule — persisted in the same turn, importance

  > = 0.8, tagged `always` when it applies everywhere.

  Docs version 1.5.0 (MCP `instructions`, `SKILL.md`, all six always-on files, `llms.txt`).

## 0.4.0

### Minor Changes

- 0cbe110: Search is now best-effort and ranked by query coverage, so a multi-word query is
  never emptied by one absent word. The `search` tool result gains `terms` and
  `partial` (plus `matched_terms` on each hit), so an agent can tell a full match
  from a ranked suggestion instead of concluding nothing exists.

  Also fixes: entity matches are now ranked and snipped from the summary (not just
  the name), conversation digests are matched on their `title` / `conversation_id` /
  `source_ai` values (the `transcript` is out of search, and JSON key names are no
  longer matched as if they were content), snippets are centred on the match,
  `type` is honoured on empty-query searches, and an unknown namespace errors
  instead of returning a misleading empty result.

  Sibling filters are hardened: `manage_memory query` and `manage_entity find` now
  match terms in any order (they required the words to be adjacent, so a natural
  multi-word query returned nothing), and every `q`/`query` filter escapes LIKE
  wildcards — `where: {q: "%"}` previously expanded to `'%%%'` and matched every row
  in the namespace, so a `batch_update` could rewrite the whole table.

  Behaviour change worth noting: `q=""` combined with `type` previously ignored
  `type`; the filter is now enforced on both search paths.

## 0.3.1

### Patch Changes

- Auto-bump: sepia-mcp (or @sepia/shared) changed

## 0.3.0

### Minor Changes

- 13bc693: Initial publish: self-contained MCP server for Sepia (stdio + HTTP), proxying all 7 tools to the Sepia REST API. Includes search indexing of conversation-digest metadata (titles now findable) and REST API coverage for all tool actions (namespace get/delete, entity/memory batch-update, tags filters).
