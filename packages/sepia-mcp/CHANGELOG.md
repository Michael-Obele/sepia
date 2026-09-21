# sepia-mcp

## 0.8.6

### Patch Changes

- Auto-bump: sepia-mcp (or @sepia/shared) changed

## 0.8.5

### Patch Changes

- Auto-bump: sepia-mcp (or @sepia/shared) changed

## 0.8.4

### Patch Changes

- Auto-bump: sepia-mcp (or @sepia/shared) changed

## 0.8.3

### Patch Changes

- Auto-bump: sepia-mcp (or @sepia/shared) changed

## 0.8.2

### Patch Changes

- Auto-bump: sepia-mcp (or @sepia/shared) changed

## 0.8.1

### Patch Changes

- Auto-bump: sepia-mcp (or @sepia/shared) changed

## 0.8.0

### Minor Changes

- a084f5e: Sepia can now record **opt-in telemetry**, so you can see whether search and memory are
  actually working instead of guessing.

  The problem it solves: without it there is no way to tell whether a ranking change helped,
  whether a query quietly returned nothing, or whether the session-start briefing ever fires.
  Every search bug in this project's history was found by an agent hitting it inside a real
  task, never by a test — this captures that signal in production.

  - **OFF by default for every account.** No row is written until the owner opts in, per
    account, and the data lives in that account's own Postgres — never sent to a third party.
    Read it or erase it at any time.
  - **Tier `signals`** records counters only: tool, engine, term count, best coverage, hit
    count, latency, payload size, and a **salted, day-rotating query fingerprint**, so
    equivalent queries group without the text being recoverable. No content, ever.
  - **Tier `transcripts`** additionally records raw query text and returned ids, expiring
    after `ttl_days` (default 30). Retention is enforced when the summary is read, because
    this app has no scheduler (Fly scales to zero) and pretending a cron exists would be worse
    than doing it on read.
  - Derived metrics: zero-result rate, repeated-query rate, reformulation rate (another search
    within 120s in the same session), per-engine comparison, latency percentiles, and briefing
    adoption — including **sessions that searched or wrote before ever calling the briefing**,
    i.e. the step-0 guarantee silently failing.
  - Never recorded at any tier: memory content, entity names, agent conversation, credentials.
  - REST: `GET|PUT /api/telemetry/settings`, `GET /api/telemetry/summary`,
    `GET /api/telemetry/events`, `DELETE /api/telemetry`.
  - CLI: `bun run scripts/telemetry.ts {status|on|off|summary|events|purge|delete}`.

  Not included: the dashboard toggle. The REST endpoints and the CLI are the surface today, so
  the opt-in exists before the UI to flip it.

## 0.7.0

### Minor Changes

- 16f64c4: `search` gains **`min_terms`** — the precision dial — and reports **`best_matched_terms`**.

  Matching is best-effort by design: a row matching ANY query word is a candidate, ranked by
  how many of them it matched. That is the right default (it is why a natural multi-word query
  no longer returns 0), but there was no way to trade recall back for precision — so a broad
  query returns common-word noise and the caller cannot distinguish "the best I could do" from
  "exactly what you asked".

  - **`min_terms`** (1-50, optional): drop hits covering fewer than this many query terms.
    Applied in SQL **before** the LIMIT, so a narrowed search still returns a full page rather
    than a truncated one. A too-high value returns 0 hits with `terms` present — that is the
    filter working, not an empty store.
  - **`best_matched_terms`** on the result: the best coverage any hit achieved. Pass it back as
    `min_terms` to keep only that coverage class.

  Also: `summarizeSearch` now derives `partial` from that single maximum instead of re-checking
  every hit. Behaviour is identical (`every(h => h.matched_terms < terms.length)` is the same
  statement as `max < terms.length`), but it resolves a contradiction found in review — two
  docstrings in `search.ts` disagreed about whether coverage dominates the score. It does
  (`coverageWeight = 20 * terms + 100` exceeds the largest possible word/phrase bonus for any
  term count), and the comment claiming otherwise is gone.

  REST: `GET /api/search?min_terms=n`.

  Docs version 1.7.0.

## 0.6.1

### Patch Changes

- Auto-bump: sepia-mcp (or @sepia/shared) changed

## 0.6.0

### Minor Changes

- 5169565: `manage_memory action: "briefing"` now returns **core only by default**, with a new
  `detail: "core" | "all"` param for the rest.

  Core is the guarantee: the rules that must be in context before any work, because relevance
  search cannot find a constraint you have not guessed at. It is a handful of rules and stays
  small, so loading it every session stays viable forever. The tail — situational and
  project-scoped rules — grows without bound (measured 2026-09-20: 9 core rules ≈ 886 tokens
  against 235 tail rules ≈ 8.5k tokens), and a long constraint list is self-defeating because
  the rules that matter stop standing out. Loading the tail by default therefore gets steadily
  more expensive and less useful.

  Default cost drops ~53% (≈1,906 → ≈886 tokens) with no rule lost.

  - `detail` (default `"core"`): `"all"` adds the tail, and is the right call immediately before
    anything slow, metered, destructive, or expensive.
  - `max_chars` now applies to `detail: "all"` only — core rules are never dropped for budget, in
    either mode, so the core briefing ignores it entirely.
  - New `other_standing` field: how many standing rules exist beyond core, so a caller always
    knows the tail is there.
  - `truncated` / `omitted` are measured against the **requested** slice, so `truncated` means
    "this answer is short of what you asked for" rather than a permanent nag about the tail you
    chose not to load.
  - REST: `GET /api/memories/briefing?detail=core|all`. An unknown value is a 422, not a silent
    coercion.

  Deliberately NOT built: server-side summarization. A constraint's power is its specificity and
  actionability — exactly what summarization removes. Measured against the real core set, cutting
  to 200 chars strips the actionable clause from 2 of 9 rules, and first-sentence extraction from
  5 of 9 — including "state the download size before any build", whose first sentence is pure
  context ("Michael is often on MOBILE DATA…"). The 400-char cap is the safe floor.

  Docs version 1.6.0 (MCP `instructions`, `SKILL.md`, all six always-on files, `llms.txt`).

## 0.5.1

### Patch Changes

- Auto-bump: sepia-mcp (or @sepia/shared) changed

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
