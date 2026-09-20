---
"sepia-mcp": minor
---

`search` gains **`min_terms`** — the precision dial — and reports **`best_matched_terms`**.

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
