---
"sepia-mcp": minor
---

Added the `wake` tool and folded `traverse_graph` into `manage_relation`.

- **`wake`** — a zero-argument readiness probe (`GET /api/wake`) that confirms the server and
  its database are answering. The shipped contract now tells every model to call it **first,
  once per chat, before the briefing**, and to retry it up to 3 times: the host sleeps when
  idle, so the first call of a conversation often lands mid-boot. It exists so a cold-start
  failure lands on a call designed to be retried instead of on `briefing`, the heaviest read
  in the system. It returns an error rather than a payload on failure, because models retry
  errors and read payloads as answers.

- **`traverse_graph` → `manage_relation action="traverse"`** (BREAKING for anyone calling
  the old tool by name). The BFS walk now takes `start_id` + `depth` (1-3) as action
  arguments and behaves identically. This holds the LLM surface at 7 tools, which
  `@sepia/shared` documents as deliberate, and roughly cancels `wake`'s schema cost in the
  model's context.

Requires a Sepia server at **1.15.0** or newer — `wake` proxies to `/api/wake`, which older
servers do not serve.
