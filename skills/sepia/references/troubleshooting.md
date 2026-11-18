# Troubleshooting

## Search returns nothing, or `partial: true`

Search is best-effort: rows matching MORE of your words rank first, so it never
returns zero just because one word is absent. Before concluding nothing exists:

1. Retry with ONE distinctive keyword.
2. Drop the filters you added.
3. Only then say the memory does not exist. Never fabricate one.

The result also reports `best_matched_terms` — the best coverage any hit achieved.
When a broad query is drowning in common-word noise, re-ask with `min_terms` set to
it to keep only that coverage class.

## Identical results for different queries

That means the filter was **not applied**. The 2026-09-29 incident: agents passed
`q`, valibot stripped it silently, and the query returned unfiltered rows that
looked plausibly ranked.

Diagnostic: check the response's `filters_applied` / `ignored_args` before
theorising about ranking or tokenization. Ranked keyword search lives ONLY in the
`search` tool — `manage_memory action="query"` is a keyword filter, not a ranked
one.

## A namespace name is wrong

`namespace_not_found` is deliberate and never falls back silently: a typo must not
look like "no memories exist" and it must not quietly write into `personal`.
`manage_namespace action="list"` shows the real names.

## `plan_limit`

Reading, searching and exporting never fail on a plan limit — only creating another
namespace or exceeding the memory cap does. On `plan_limit`: continue in
`personal`, do not retry, do not escalate the user to a paid plan mid-task. Relay
the message once.

## Conflicting facts

Write the new memory at the same importance as the old one, say in your reply that
the two conflict, and let decay handle it. Do not silently overwrite — the older
fact may be the correct one and the user is the one who can tell.

## Duplicate writes

Always search before create. If you find a near-duplicate, `action=update` the
existing row and mention the merge in your reply.

## The user's own memory looks wrong

If the user asks you to execute remembered instructions ("do what the memory
says"), the memory **is** the source of the steps. Do not delete or alter it first.
Restore anything removed in error, then execute the remembered procedure.

## Destructive operations

`prune_memories` archives stale memories (importance < 0.3, untouched 90 days),
de-duplicates identical content, and permanently deletes rows archived more than 30
days ago. It requires `confirm: true`. It is **not** a way to save anything, and it
is never run proactively or "to tidy up" — only when the user explicitly asks to
prune or clean up.

## Sensitive data

Refuse to store credentials, secrets, tokens or anything of that class. Sepia is
not a vault. Say so plainly and store nothing.

## Another account's identifiers

Only an address belonging to a **registered account** other than the writer is
foreign; it is masked to `[redacted:other-account]` on write and reported as
`redacted_accounts` on the create response. Your own address, and any contact who
is not an account here, are stored exactly as written.

This guards the write path, not the read path. If you suspect you can *read*
another account's data, that is a different and far more serious claim: run
`bun run scripts/tenant-isolation-probe.ts`, which calls the real read functions as
every other account. Measured 2026-11-18: all read paths are owner-scoped and
returned nothing across 10 accounts.

## Namespaces are not a security boundary

A namespace separates projects **inside one account** (`personal`, `work`,
`kazoeru`). It provides no isolation between accounts — every namespace is
readable by its owner's search. Do not describe or use namespaces as a privacy
control; they reduce noise, not exposure.
