# Conversation handoff and resume

When the user says **"save this conversation"**, **"hand off to another AI"**,
**"migrate my context"**, **"continue this elsewhere"**, or is switching assistants
mid-task, call `manage_memory action="ingest"` with a `conversation` payload.

The **departing agent distils** — you have the context, you are the best distiller.
The receiving agent gets the digest plus the evidence it links to, so a bad digest
is not recoverable downstream.

## Payload

- `summary` (≤ 4000 chars) — structured markdown: context, decisions, open
  questions, pointers.
- `conversation_id` — groups the digests of one conversation.
- `title` — human readable, e.g. "Auth migration — Neon vs Supabase". This is how
  conversations are told apart when resuming; never skip it.
- `status` — `active` (resume me) | `paused` | `done`.
- `decisions` / `preferences` / `instructions` / `observations` /
  `open_questions` — the evidence, **verbatim**. Exact errors, paths, IDs,
  commands. Never soften them; a summary that rounds off an error message passes a
  bug straight to the next agent.
- `entities` — find-or-create.
- `source` `{ ai, ref }` — which assistant, and a pointer to the raw session
  (session-log path or share URL). This is the primary fidelity mechanism.
- `transcript` — optional, and only when the raw log actually exists (online chat
  models usually do not expose one).
- `namespace` — the project this belongs to.

## What the server does

Atomically: one **digest** memory (tagged `conversation`, importance 0.85,
protected from consolidation) + the typed constituent memories + the entities.
Digests are exempt from stale archiving.

## Rules

1. **One digest per major topic**, all sharing the same `conversation_id`. Multiple
   digests are one conversation.
2. If the summary does not fit in 4000 characters, **split into more digests**.
   Never pad and never truncate evidence.
3. `open_questions` become observation memories tagged `open-question` — the next
   agent's starting point.

## Resuming

`search q="" tags=["conversation"]` lists the digests. Prefer the one with
`status=active`, or the most recent. Read the digest, then pull the constituents
through its entity links or by tag.

When a conversation finishes, update its digest metadata `status` to `done` — read
the digest first, then write back the full metadata plus the new status, because
metadata replaces rather than merges. Resuming a paused conversation: set it back
to `active`.
