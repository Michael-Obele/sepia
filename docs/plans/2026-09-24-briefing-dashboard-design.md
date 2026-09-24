# Design — `/app/briefing`: edit the standing-rules briefing from the dashboard

**Date:** 2026-09-24 · **Status:** approved (user-selected options below) · **Approach:** dashboard-only

## Problem

The standing-rules briefing (`manage_memory action=briefing`) is the unconditional
session-start read every AI loads. Today it is:

- **read-only over REST** (`GET /api/memories/briefing` in `src/api.ts`),
- **invisible on the dashboard** — the only mention is a stat on `/app/telemetry`,
- editable only by hunting individual rows through `/app/memories`, with no view of what
  the AI actually gets (core vs tail, compaction, counts, truncation).

The user wants to **update the briefing's data from the dashboard UI**, and wants the AI
to be able to do it too.

## Decisions (user-confirmed, 2026-09-24)

| Question | Decision |
| --- | --- |
| UI shape | **Dedicated `/app/briefing` page** (not a filter on `/app/memories`, not read-only) |
| AI write access | **Already works — verify + show it.** The briefing is computed from ordinary memories; the MCP `manage_memory` `update`/`batch_update` actions edit the same rows (the 1.6.0 curation pass was 11 such writes). No new MCP surface — keeps the 7-tool philosophy. |
| Capabilities | **All four:** inline edit · add/archive/delete · "as the AI sees it" preview · namespace selector |
| Approach | **1 — dashboard-only.** Zero server/shared/MCP/REST changes, no deploy, no `DOCS_VERSION` bump. |

## Architecture

```mermaid
flowchart LR
    P["/app/briefing page"] --> R["getBriefingData remote<br/>(query, requireAuth)"]
    R --> G["getBriefing() — @sepia/shared"]
    G --> DB@[(Postgres)]
    P -->|"Edit / New / Archive / Delete"| W["existing remotes:<br/>addMemory · updateMemoryData · removeMemory"]
    W --> DB
    P -->|"on open of a rule"| D["getMemoryDetail<br/>(namespace, full text, tags, updatedAt)"]
    D --> DB
    AI["AI via MCP<br/>manage_memory update/batch_update"] --> DB
```

- The page reads through **the same `getBriefing()` function the MCP briefing action
  runs** — it shows literally what the AI gets, not a copy.
- All writes reuse existing dashboard remotes; both surfaces hit the same rows, so a
  dashboard edit appears in the AI's next briefing and vice versa.
- `BriefingItem` = `{ id, type, content (compacted to 400 chars), importance, tags, core }`
  — no namespace/updatedAt/source. Per-rule extras come from the existing
  `getMemoryDetail` query when a rule is opened for editing (approach 2 — extending
  `BriefingItem` — was explicitly deferred).

## Files

| Op | File | Responsibility |
| --- | --- | --- |
| Create | `dashboard/src/lib/remote/briefing.remote.ts` | `getBriefingData` query — valibot `{ namespace?, detail? }`, `requireAuth()` + `db()`, wraps `getBriefing` |
| Create | `dashboard/src/routes/app/briefing/+page.svelte` | The page (below) |
| Modify | `dashboard/src/lib/remote/index.ts` | Export `getBriefingData` |
| Modify | `dashboard/src/lib/components/app-sidebar.svelte` | Nav item `{ href: '/app/briefing', label: 'Briefing', icon: ScrollText }` after Memories |
| Modify | `dashboard/src/lib/components/memory-form-dialog.svelte` | Optional `briefing` prop → **"Always — load at every session" Switch** that add/removes `always` from the parsed tag set |

No changes to `packages/shared`, `src/`, `packages/sepia-mcp`, or REST.

## Page layout

- **Header + controls:** namespace `Select` (All + owned namespaces) · `Tabs`
  **Core only / All standing rules** (`detail=core|all`) · **New standing rule** button.
- **Stats strip:** core count · tail count (`other_standing`) · returned count ·
  `truncated`/`omitted` warning when present · **approx tokens** of the default briefing
  (compacted core chars ÷ 4, labeled "approx").
- **Rule cards** in `getBriefing` order (core first, then importance desc): badges for
  type, `always`/core, namespace, importance %; the **compacted 400-char content as the
  AI sees it** with a "full text longer" hint; actions Edit · Archive · Delete.
  Archived rows drop out of the briefing automatically (`getBriefing` filters
  `archived = false`).
- **New-rule prefill:** type `instruction`, importance `0.9` → lands in core by default.
- **Parity note in header:** *"You edit these here; your AIs edit them via
  `manage_memory` — same data."*
- **Empty/error states:** friendly empty card; `:catch` + `toast` like `memories/[id]`.

## Correctness constraints (from repo memory — verified, not assumed)

- **`tags` in an update REPLACES the whole tag set.** The dialog already round-trips the
  full list (`tagsText` ← existing tags → parsed on save), so the `always` Switch must
  add/remove within that parsed set — never send a partial set.
- All `{#each}` blocks keyed (Svelte 5 / autofixer requirement).
- Quality gate: `bun run check` → 0 errors, `bunx prettier --write`, svelte-autofixer → 0 issues.
- Never start dev servers or builds — ask the user which port the dashboard runs on.

## Out of scope

- No summarizer/compaction change (measured: compression loses the operative clause —
  400-char cap loses 0 of 9 rules, 200 loses 2).
- No REST write endpoints (approach 3) — `PATCH /api/memories/:id` already covers scripts.
- No MCP changes: `briefing` stays read-only; writes stay on `update`/`batch_update`.
- No `BriefingItem` extension (approach 2) — deferred until the list needs
  source/updated-at on every card.

## Verification of AI parity (part of acceptance)

1. Edit a rule on the page → call `manage_memory action=briefing` → change is present.
2. `manage_memory action=update` on a rule → refresh page → change is present.
3. Toggle `always` off on a ≥0.9 rule → stays core; on a <0.9 rule → enters/leaves core.
