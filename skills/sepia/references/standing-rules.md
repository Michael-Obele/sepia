# Standing rules and the briefing

Some memories are **standing rules**: how the user wants you to behave,
everywhere. They are the rules you do not yet know you need — and that is exactly
why keyword search cannot find them. Relevance is measured against a task you have
not scoped yet, so a rule whose existence you have not guessed is unsearchable by
construction. The briefing is therefore unconditional.

## Core is tag-only

A memory is core when, and only when, it carries the `always` tag. Importance ranks
rules within the briefing; it never admits one.

Before 2026-09-24 the predicate was `tagged always OR importance >= 0.9`, which
silently admitted every high-importance row — including project-scoped rules that
then shipped into every session — and made removal impossible without corrupting
the importance score. One knob decides membership (the tag), one decides rank
(importance). Adding the tag puts a rule in; removing it takes the rule out.

Tag `always` only when the rule applies in **every** repo and **every** session. A
rule specific to one project must not carry it.

## Core versus tail

- **Core** is the guarantee. It is small and stable, so it can be loaded every
  session forever, and it is never dropped for budget: if the budget cannot hold
  it, the result overshoots rather than thinning the rules that matter.
- **The tail** is everything else standing — situational and project-scoped. It
  grows without bound, and anything that loads it by default degrades as the user
  keeps working. Load it deliberately with `detail: "all"` before anything slow,
  metered, destructive or expensive (install, build, deploy, deletion, infra
  change).

The response reports `other_standing` — the count of tail rules that exist but were
not returned — so a caller always knows the tail is there.

## Namespace scoping

With per-project namespaces, core loads from **every** namespace while the tail
loads only from the one named. `other_scopes: { tail: n }` reports the part of the
tail that lives elsewhere, so it stays discoverable without being loaded.

This asymmetry is deliberate: scoping core would make a universal rule disappear in
every project except the one it was filed under, which is a behaviour regression
disguised as tidying.

## Why not compress instead of scope

Do not re-litigate this: when the payload is too big, **scope it, never compress
it.** Measured against a real core set:

- A 400-character cap is a floor, not a preference. Cutting to 200 characters
  strips the actionable clause from 2 of 9 rules.
- First-sentence extraction strips it from 5 of 9 — including "state the download
  size before any build", whose first sentence is pure context.
- A server-side summariser deletes the rules that matter.

A rule's power is its specificity. A paraphrase keeps the sentiment and loses the
trigger. Each rule is compacted to 400 characters in the briefing, and the full
text is always one `manage_memory action="get"` away on its `id`.

## Escalation and budget

- Default call returns core. `detail: "all"` adds the tail.
- `max_chars` defaults to 8000; the maximum is 200000 (`BRIEFING_FETCH_MAX` rows ×
  `BRIEFING_ITEM_CHARS`), the physical maximum, so `detail: "all"` at max is
  everything.
- If the response says `truncated: true`, raise `max_chars` — the `omitted` count is
  exact, never inferred, so what you did not see is always knowable.
- On a very large context window (~1M tokens), make the **first** call
  `detail: "all"` at maximum `max_chars` instead: the whole standing set is roughly
  10k tokens, about 1% of that window, read once per session. Core-by-default exists
  to protect small contexts, not to withhold rules from big ones. If you do not know
  the window size, keep the default.
