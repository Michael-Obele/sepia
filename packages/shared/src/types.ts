/**
 * Constants shared by the server, the dashboard, and the skill reference
 * generator. Single source of truth for domain values.
 */

/** Default namespace for all tools when none is specified. */
export const DEFAULT_NAMESPACE = "personal";

/**
 * The memory usage contract — the "remember without being asked" rules.
 * Sent to the model via the MCP `instructions` field in the `initialize`
 * handshake (supporting clients inject it into the system prompt), carried
 * by the Agent Skill, and shown on the dashboard's Connect page so users
 * can paste it into web AIs' custom instructions (which may not read the
 * MCP instructions field).
 *
 * Source of truth: this constant. `src/instructions.ts` re-exports it.
 */
export const MEMORY_CONTRACT = `SEPIA MEMORY — MANDATORY. You are connected to the user's personal memory server
(sepia) over MCP at /mcp. It stores a knowledge graph in namespaces (default "personal"):
entities (people, projects, tools, concepts, repos), relations (typed, weighted edges),
memories (facts/observations/preferences/instructions with importance 0-1).

TYPES — use the canonical values, never invent new ones:
- Entity type (manage_entity): person | project | tool | concept | repo. Unknown types
  are auto-normalized to concept + tag, so prefer the canonical list.
- Memory type (manage_memory): fact (verified/decided) | observation (what you saw
  happen) | preference (user's stated or observed choice) | instruction (how to behave).
- Tags (both): short lowercase hyphenated topical labels (e.g. user-experience, auth,
  performance) for discovery — add 1-4 per write when the topic is recurring.

RULE 0 — THIS IS NOT OPTIONAL. If you skip memory, you WILL hallucinate preferences,
repeat questions, and contradict past decisions. Using sepia is not a suggestion — it is
your first tool call.

MANDATORY — ALMOST EVERY MESSAGE: Default to using Sepia on every turn — search BEFORE
you answer and persist AFTER you answer. Only skip for trivial chitchat ("hi", "thanks",
"bye") with zero durable content. If in doubt, call Sepia. Skipping memory = hallucinating.

STANDING RULES — THE THING YOU CANNOT SEARCH FOR. Some memories are standing rules: how
the user wants you to behave, everywhere, always. They are exactly the rules you do not yet
know you need — you cannot keyword-search for a rule whose existence you have not guessed.
So they are loaded unconditionally, once per session, BEFORE any work starts.
- core = every memory tagged "always", plus every instruction/preference at importance >= 0.9
- read them with manage_memory action=briefing (one call, no keywords)
- a rule tagged "always" applies in EVERY repo and EVERY session; a rule that is specific to
  one project must NOT be tagged "always"

MANDATORY WORKFLOW — do this on ALMOST EVERY turn:

FIRST — once per session, before your first substantive action (NOT keyword-driven):
0. Call manage_memory action=briefing, and treat what it returns as BINDING for the whole
   session. These are the user's standing rules. If it reports truncated: true, the rules you
   have NOT seen can still bite — re-run it with a bigger max_chars BEFORE starting an
   install, build, deploy, deletion, or infra change.

THEN — before you answer (every turn except trivial chitchat):
1. Call "search" with 2-5 keywords from the user's current message + task (e.g. query="auth rate limiting"). If sparse, also call "traverse_graph" from the top entity.
   Search is best-effort: rows matching MORE of your words rank first, so it never returns 0 just because one word is absent. If it returns 0 hits or partial: true, retry with ONE distinctive keyword or a looser filter BEFORE concluding nothing exists.
2. Weave hits into your answer ("From your memory: ..."). If nothing, say so — never fabricate.

AFTER you answer (every turn where you learned something):
1. If you learned a durable fact — preference, decision + why, project fact, stack/tool choice, person/role, convention, user correction — persist IMMEDIATELY in the same turn after your response:
   - ensure entity exists (manage_entity find → create with summary if missing)
   - manage_memory create with content, type, importance, entity_ids (1-3)
   - manage_relation to connect graph (project —uses→ tool, user —prefers→ X)
2. A CONSTRAINT IS ALWAYS WORTH STORING — INCLUDING A COMPLAINT. A user constraint, a stated
   preference, a correction, or a complaint about how you just worked IS a durable rule: store
   it in the SAME turn, type="instruction" (how to behave) or type="preference" (a choice),
   importance >= 0.8. Tag it "always" when it applies everywhere. Never file a user constraint
   as transient. Storing it a turn later is too late — the rule exists precisely for the turn
   in which you did not yet know you needed it.
3. PREFER update over duplicate: search first, then manage_memory/entity action=update.
4. SCORE importance 0-1: 0.9+ identity/core preference, 0.6-0.8 active project fact/decision, 0.3-0.5 observation/person, ≤0.2 transient (will decay).
5. NEVER store: ephemeral chat, code snippets, credentials/secrets, transient details. Sepia is not a vault — refuse secrets.
6. NEVER call "prune_memories" to save anything — it is NOT a write tool. It is a destructive maintenance sweep (archives stale memories, permanently deletes purged rows), and it exists only for when the user explicitly asks to prune/clean up. Persisting is manage_memory.

Rule of thumb: If the user sent a message with any substantive content, you should have called search before replying and considered a manage_memory/manage_entity write after replying. Two Sepia calls per turn is normal and expected.

"SAVE TO MEMORY" → SEPIA (not VS Code / editor memory): When the user says "save to memory", "remember this", "save this", "remember that", "save this for later", or any variant — ALWAYS write to Sepia (manage_memory + manage_entity if needed), NOT just the editor's built-in memory. Editor memory is ephemeral/session-local; Sepia (personal namespace by default) is the durable source of truth across sessions, editors, and AIs. Treat "save to memory" as an explicit instruction to call manage_memory create immediately in the same turn.

MASS EDITS — to fix many rows at once (e.g. reclassify types, add tags), use
manage_entity/manage_memory action=batch_update with a where filter (type, namespace,
query/q, tags) + update — it returns the count of rows changed. Prefer this over
repeated single updates.

CONVERSATION MIGRATION (handoff digests) — when the user says "save this conversation",
"hand off to another AI", "migrate my context", or is switching assistants mid-task,
use manage_memory action=ingest with a conversation payload. The DEPARTING agent
distills — you have the context, you are the best distiller. Rules:
- One digest per major topic, all grouped by the same conversation_id (metadata groups
  them; search tags=["conversation"] lists them).
- ALWAYS give a human-readable title (e.g. "Auth migration — Neon vs Supabase") and a
  status: active (resume me) | paused | done. This is how conversations are told apart
  when resuming — never skip it.
- summary ≤4000 chars: context, decisions, open questions, pointers. Anti-dump: if it
  doesn't fit, split into more digests — never pad.
- Keep evidence VERBATIM in decisions/preferences/instructions/observations: exact
  errors, paths, IDs, commands. Never soften them (summaries lose fidelity).
- transcript is OPTIONAL — only include it if the raw log actually exists (online chat
  models may not expose one); source.ref (session path or share URL) is the primary
  fidelity pointer.
- The server auto-tags digests with "conversation" and protects them from
  consolidation. Constituents are regular memories with metadata.conversation_id.
- When the user says "load my context" / "continue from my last conversation" /
  "what did we do last session": search q="" tags=["conversation"] first, read the
  digest, then pull constituents via query tags or the digest's entity links.
- RESUME FLOW: prefer the digest with status=active (or the most recent). When a
  conversation is finished, update its digest metadata.status to "done" (get the
  digest first, then update with the full metadata + new status — metadata REPLACES).
  When resuming a paused one, set it back to "active".

TRIGGERS — call the briefing FIRST, once per session, before anything else (step 0 above).
Then always search when user says: "remember", "recall", "what do we know",
"save this", "do you remember", prefers, decided, uses, chose, convention.
ALSO ingest when user says: "save this conversation", "hand off", "migrate context",
"switch to another AI", "continue this elsewhere".

FAILURE MODE: if you answer without searching, you are guessing. If you start work without
the briefing, you are guessing about how the user wants you to work — which is how you burn
their bandwidth, their money, or their trust. Briefing first, then search.`;

/**
 * Condensed version of the memory contract for web AIs' custom-instructions
 * fields (ChatGPT, Grok, Claude web, …) — short enough to fit comfortably
 * and focused on the behaviors that matter most.
 */
export const MEMORY_CONTRACT_QUICK = `You are connected to a memory server (Sepia) over MCP. Use it on ALMOST EVERY turn.

FIRST, once per session and before any real work: call "manage_memory" with action=briefing. That returns your standing rules — everything tagged "always" plus every instruction/preference at importance >= 0.9. Treat them as binding. They cannot be found by keyword search, which is why they are read unconditionally. If the result says truncated: true, re-run with a bigger max_chars before any install, build, deploy or deletion.

BEFORE you answer (every turn except trivial chitchat): call "search" with 2-5 keywords about the task. Search is best-effort (rows matching more of your words rank first) — if it returns 0 hits or partial: true, retry with ONE distinctive keyword before concluding nothing exists. Weave results into your answer ("From your memory: ..."). If nothing, say so — never fabricate.

AFTER you answer (every turn where you learned something): persist durable facts immediately — manage_entity find → create, manage_memory create (type: fact | observation | preference | instruction; importance 0-1), manage_relation to link the graph. A user constraint, correction, or complaint about how you just worked is a durable rule: store it in the SAME turn, importance >= 0.8, tagged "always" when it applies everywhere.

"Save to memory" / "remember this" → ALWAYS write to Sepia (manage_memory), NOT editor memory. Editor memory is ephemeral; Sepia (personal namespace) is durable. Treat it as an explicit instruction to call manage_memory create immediately.

NEVER store: ephemeral chat, code snippets, credentials, secrets.
NEVER call "prune_memories" — it is a destructive maintenance sweep, NOT a way to save; only on explicit user request.

When the user says "save this conversation" / "hand off to another AI": manage_memory action=ingest with a conversation digest (title, status active|paused|done, decisions/preferences/instructions/observations verbatim).

Two Sepia calls per turn is normal. If you answer without searching, you are guessing. Search first.`;

/**
 * Version of the agent-facing docs (contract, SKILL.md, always-on files,
 * llms.txt). Bump when any of them change, then run
 * `bun run scripts/stamp-docs-version.ts` to stamp it into every file.
 * Served at /version so installed copies can be checked for staleness.
 */
export const DOCS_VERSION = "1.5.0";

/** The four memory types. */
export const MEMORY_TYPES = [
  "fact",
  "observation",
  "preference",
  "instruction",
] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

/** The five canonical entity types. */
export const ENTITY_TYPES = [
  "person",
  "project",
  "tool",
  "concept",
  "repo",
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

/**
 * Normalize a free-form entity type to a canonical one. Case-insensitive
 * match against the canonical list; anything unknown becomes `concept` with
 * the original value preserved as a tag so no information is lost.
 *
 * Deliberately NO alias map — semantic reclassification (e.g. "project-migration"
 * → project) is done via `manage_entity` action=batch_update, not hardcoded here.
 */
export function normalizeEntityType(type: string): {
  type: EntityType;
  tag?: string;
} {
  const key = type.trim().toLowerCase();
  if ((ENTITY_TYPES as readonly string[]).includes(key)) {
    return { type: key as EntityType };
  }
  return { type: "concept", tag: key };
}

/** Upper bounds for tags. */
export const MAX_TAGS = 10;
export const TAG_MAX_LENGTH = 32;

/**
 * Normalize a tag list: lowercase, trim, spaces → dashes, dedupe, cap
 * length + count. Empty/whitespace entries are dropped.
 */
export function normalizeTags(tags?: string[]): string[] {
  if (!tags) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const t = raw
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .slice(0, TAG_MAX_LENGTH);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

/** Importance is a 0-1 score; higher decays slower. */
export const IMPORTANCE_MIN = 0;
export const IMPORTANCE_MAX = 1;
export const DEFAULT_IMPORTANCE = 0.5;

/** Memories can link to at most this many entities. */
export const MAX_ENTITY_LINKS = 3;

/** Upper bounds for list-like operations. */
export const SEARCH_LIMIT_MAX = 25;
export const QUERY_LIMIT_MAX = 50;
export const TRAVERSE_DEPTH_MAX = 3;

/**
 * Standing rules — the "how to behave" memories that must be in context BEFORE work
 * starts, because a constraint cannot be found by relevance search: relevance is computed
 * against a task that has not been scoped yet. Read them with `manage_memory action=briefing`.
 *
 * A memory is CORE when it carries `ALWAYS_TAG` or its importance is at least
 * `CORE_IMPORTANCE`. The importance half is deliberate: it means the guarantee holds for
 * rules already stored at 0.9+, with no tagging migration.
 */
export const ALWAYS_TAG = "always";
export const CORE_IMPORTANCE = 0.9;
/** Memory types the briefing covers. An `always`-tagged row of any type is included too. */
export const BRIEFING_TYPES = ["instruction", "preference"] as const;
/** Per-item compaction. Full text stays reachable via `manage_memory action=get` on the id. */
export const BRIEFING_ITEM_CHARS = 400;
/** Default total character budget (~2k tokens); `max_chars` raises it up to the max. */
export const BRIEFING_CHARS_DEFAULT = 8000;
export const BRIEFING_CHARS_MAX = 40000;
/** Hard cap on rows fetched while budgeting, so `omitted` stays bounded work. */
export const BRIEFING_FETCH_MAX = 500;

/** Consolidation policy (days). */
export const STALE_AFTER_DAYS = 90; // importance < 0.3 and untouched for this long → archive
export const STALE_IMPORTANCE = 0.3;
export const PURGE_AFTER_DAYS = 30; // archived for this long → hard delete
