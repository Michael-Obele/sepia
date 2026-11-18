# Namespaces — one per project

A namespace is an isolated container: its entities, relations and memories never
mix with another's. Sepia uses that as the **project boundary**.

## Why

Everything in one bucket does not scale. Measured on a real account in 2026-11:
one `personal` namespace held 500 standing rules — 57 core, 448 tail — spanning a
dozen unrelated projects. A rule that is always present stops standing out, and a
person who cannot follow their own rule list stops trusting it.

Splitting per project fixes two things at once:

- **The briefing shrinks.** Core (`always`-tagged) still loads everywhere, because
  a universal rule must not vanish in the projects it was not filed under. The
  project-scoped tail only loads for that project.
- **Search gets honest.** A search for "the deploy command" in the `kazoeru`
  namespace cannot return `ikoro`'s.

## Naming

**The repo slug**, lowercase, hyphenated: `kazoeru`, `ikoro`, `tomoshibi`.

It is the one string an agent always knows without asking — it can read
`package.json`, `.git/config`, or just look at its working directory. Prefixed
forms (`project/kazoeru`) buy nothing and cost escaping in every filter. Rename a
namespace when the repo is renamed: `manage_namespace action="update"`.

## The session contract

1. `manage_namespace action="ensure" name="<repo-slug>"` — once, at the start.
   Get-or-create, so it is idempotent and cannot fail on "already exists". The
   response says `created: true|false`, which is worth one line to the user when
   it is a new project.
2. Pass `namespace="<repo-slug>"` on **every** call: `manage_memory`,
   `manage_entity`, `manage_relation`, `search`, and the `briefing`.
3. `personal` remains the cross-project bucket — genuine cross-project knowledge,
   plus anything universal.
4. If `ensure` or `create` returns `plan_limit`, continue in `personal`. Do not
   retry and do not turn a limit into a blocked task.

## Plan limits

| Plan | Namespaces |
| --- | ---: |
| free | 1 (`personal` only) |
| pro | 100 |

Reading, searching and exporting are never blocked on either plan — only creating
another namespace is. A `plan_limit` error names the plan and the upgrade path;
relay it once and move on.

## Tagging: `always` versus project scope

`always` means **every repo, every session**. It is the switch that makes a rule
load in every namespace, so the tag is a promise, not an emphasis.

- Universal ("don't hardcode versions", "warn before downloads over 300 MB",
  "no AI attribution in commits") → `always`.
- Project-specific ("Kazoeru is a Bun monorepo", "the lanyard bridge has no
  read-only mode") → the project's namespace, no tag.

A project rule wrongly tagged `always` is the single biggest source of briefing
noise: it loads everywhere and matters in one place. If a rule names a project, it
does not belong in core.

## Refiling a misfiled memory

`manage_memory action="update"` accepts `namespace` and moves the row. For a batch:

```
manage_memory action="batch_update"
  where:  { namespace: "personal", q: "kazoeru" }
  update: { namespace: "kazoeru" }
```

One caveat, by design: **entity links do not follow the move.** A link points at
an entity that still lives in the old namespace, so moving a memory leaves a
cross-namespace link behind. If the memory's value comes from those links, move or
recreate the entity too.

## Splitting an existing `personal`

Nothing deletes. The procedure, which the migration script follows:

1. For each memory in `personal`, follow its entity links to entities of type
   `project`.
2. Exactly one project → that project's namespace.
3. Several projects → assign to the highest-importance one and **report it** for
   review rather than guessing silently.
4. No project link → stays in `personal`.
5. Any memory tagged `always` → **stays in `personal`**, whatever its links. A
   universal rule filed under one project stops loading in the others.
6. Run as a dry run first, read the table, then apply.

## Checking your own work

`manage_namespace action="list"` returns every namespace with entity, memory and
relation counts. A project namespace with three memories after a week of work means
the scoping is not being applied — fix the writing, not the reading.
