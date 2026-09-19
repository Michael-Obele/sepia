# sepia-mcp

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
