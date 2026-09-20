---
"sepia-mcp": minor
---

`manage_memory action: "briefing"` now returns **core only by default**, with a new
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
