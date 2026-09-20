---
"sepia-mcp": minor
---

Sepia can now record **opt-in telemetry**, so you can see whether search and memory are
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
