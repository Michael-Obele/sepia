---
"sepia-mcp": minor
---

Briefing: large-context models (~1M tokens) are now instructed to request `detail: "all"` on their first session-start call — the whole standing set is ~10k tokens (≈1% of such a window), read once per session, priority-ordered with core first. `BRIEFING_CHARS_MAX` raised 40000 → 200000 and defined as `FETCH_MAX × ITEM_CHARS`, the physical maximum a briefing can return, so `detail: "all"` at max is everything rather than a silent subset (measured 2026-09-24: the real standing set was 37,527 chars — 94% of the old cap and growing). Core remains the default everywhere else; docs contract, SKILL.md, all 6 always-on files, llms.txt, and the tool schema descriptions updated (docs 1.10.0).
