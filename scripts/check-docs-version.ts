/**
 * Verifies every version marker in the sepia docs — the ones in this repo and
 * the copies installed on this machine.
 *
 * Usage:
 *   bun run scripts/check-docs-version.ts --source-only   # repo only, no network (CI)
 *   bun run scripts/check-docs-version.ts                 # + installed copies vs /version
 *   bun run scripts/check-docs-version.ts http://localhost:8080
 *
 * Fails on four things, and names them apart:
 *   - DISAGREEMENT — one file carrying two different versions (frontmatter
 *     1.0.0 next to a body marker 1.9.0). Reading only the first marker is what
 *     hid this for months: the check printed "all current" while VS Code,
 *     Cursor and SKILL.md visibly said 1.0.0.
 *   - UNMARKED — the file exists but lacks a marker it declares, including
 *     having none at all. A deleted marker used to look exactly like "not
 *     installed here" and exited 0, so it stayed green forever.
 *   - STALENESS — a copy behind the served version.
 *   - ABSENT — only fatal for a repo file, which the manifest says must exist.
 */
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DOCS_VERSION } from "@sepia/shared/types";
import {
  AGENT_DOCS,
  describeMarkers,
  isAheadOfServer,
  outcome,
  verdict,
  type MarkerKind,
  type Verdict,
} from "./docs-manifest.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
/** Repo-only mode: no network, safe in CI. */
const SOURCE_ONLY = args.includes("--source-only");
const BASE = args.find((a) => !a.startsWith("--")) ?? "https://sepia.fly.dev";

const HOME = homedir();

/** Marker kinds a doc declares — installed copies inherit them from source. */
function declaredFor(sourcePath: string): MarkerKind[] {
  const doc = AGENT_DOCS.find((d) => d.path === sourcePath);
  if (!doc) {
    // Loud, not a TypeError three frames later: a typo'd `source` here would
    // otherwise check an installed copy against no contract at all.
    throw new Error(
      `unknown source doc in an INSTALLED entry: ${sourcePath} — add it to AGENT_DOCS in scripts/docs-manifest.ts`,
    );
  }
  return doc.markers;
}

const VSCODE = "skills/sepia/always-on/vscode.instructions.md";
const CURSOR = "skills/sepia/always-on/cursor.mdc";
const CLAUDE = "skills/sepia/always-on/claude.md";
const AGENTS = "skills/sepia/always-on/agents.md";
const OPENCODE = "skills/sepia/always-on/opencode.md";
const ZED = "skills/sepia/always-on/zed.md";
const SKILL = "skills/sepia/SKILL.md";

/**
 * Every place an installed copy can live, and the source doc it mirrors.
 * `source` supplies the declared markers, so an installed copy is held to the
 * same contract as the file it came from.
 *
 * KEEP IN SYNC with scripts/install-skill.sh and scripts/remote-install.sh —
 * the mapping is which file each installer WRITES where, and a wrong entry
 * makes every ✅ evidence about the wrong content. (OpenCode's always-on block
 * is `agents.md`, not `opencode.md`; `opencode.md` is only fetched by the
 * remote installer, to `~/.config/opencode/sepia.md`.)
 *
 * Repo-internal paths resolve against ROOT, never the caller's cwd: running
 * this from a subdirectory used to silently check a different repo's file and
 * still report "No stale copies".
 */
const INSTALLED: {
  label: string;
  path: string;
  source: string;
  /**
   * sepia's OWN file (sepia-named, or under a `sepia/` folder). For these, the
   * file existing at all means sepia installed it there, so a missing version
   * marker is a failure rather than "not installed here". Block-installed files
   * (CLAUDE.md, AGENTS.md) are shared, and get the same strength only from the
   * `sepia:start` block they carry.
   */
  owned?: boolean;
}[] = [
  {
    label: "VS Code prompts",
    path: join(HOME, ".config/Code/User/prompts/sepia.instructions.md"),
    source: VSCODE,
    owned: true,
  },
  {
    label: "VS Code workspace",
    path: join(ROOT, ".github/instructions/sepia.instructions.md"),
    source: VSCODE,
    owned: true,
  },
  {
    label: "Cursor rules",
    path: join(HOME, ".cursor/rules/sepia.mdc"),
    source: CURSOR,
    owned: true,
  },
  {
    label: "Cursor workspace",
    path: join(ROOT, ".cursor/rules/sepia.mdc"),
    source: CURSOR,
    owned: true,
  },
  {
    label: "Claude Code CLAUDE.md",
    path: join(HOME, ".claude/CLAUDE.md"),
    source: CLAUDE,
  },
  {
    label: "Codex AGENTS.md",
    path: join(HOME, ".codex/AGENTS.md"),
    source: AGENTS,
  },
  {
    label: "OpenCode AGENTS.md",
    path: join(HOME, ".config/opencode/AGENTS.md"),
    source: AGENTS,
  },
  { label: "Home AGENTS.md", path: join(HOME, "AGENTS.md"), source: AGENTS },
  {
    label: "OpenCode always-on",
    path: join(HOME, ".config/opencode/sepia.md"),
    source: OPENCODE,
    owned: true,
  },
  {
    label: "Zed always-on",
    path: join(HOME, ".config/zed/sepia.md"),
    source: ZED,
    owned: true,
  },
  {
    label: "Repo AGENTS.md",
    path: join(ROOT, "AGENTS.md"),
    source: "AGENTS.md",
  },
  // The skill channel — never checked at all before, which is how SKILL.md's
  // frozen frontmatter stayed invisible.
  ...["agents", "cursor", "claude", "codex", "opencode"].map((dir) => ({
    label: `Skill (~/.${dir}/skills)`,
    path: join(HOME, `.${dir}/skills/sepia/SKILL.md`),
    source: SKILL,
    owned: true,
  })),
  {
    label: "Skill (repo .opencode)",
    path: join(ROOT, ".opencode/skills/sepia/SKILL.md"),
    source: SKILL,
    owned: true,
  },
];

let failures = 0;
/** Files that simply are not installed on this machine — not a problem. */
let notInstalled = 0;
/** Copies newer than the server: normal between install-skill.sh and deploy. */
let ahead = 0;

/** One line describing a verdict — so ✅ / ⚠ / ❌ all read the same way. */
function describe(
  v: Verdict,
  opts: { phase: "source" | "installed"; expected: string; fix: string },
): string {
  switch (v.state) {
    case "ok":
      return `${v.version} (${describeMarkers(v.found)})`;
    case "absent":
      return opts.phase === "source"
        ? "declared in scripts/docs-manifest.ts but the file does not exist"
        : "not installed";
    case "unmarked":
      return `${v.missing.join(", ")} marker missing — ${
        v.found.length > 0
          ? `found ${describeMarkers(v.found)}`
          : "the file carries NO version marker at all"
      }`;
    case "conflict":
      return `markers disagree — ${describeMarkers(v.found)}`;
    case "stale":
      // Same predicate `outcome` uses, so the wording can never tell you to
      // wait for a deploy while the severity says the file is simply wrong —
      // for a SOURCE file, "ahead" means DOCS_VERSION was lowered below a
      // stamped file, which is always wrong and needs the stamp hint.
      return isAheadOfServer(v, opts)
        ? `${v.found[0]!.version} is ahead of ${opts.expected} — deploy pending? (${describeMarkers(v.found)})`
        : `${describeMarkers(v.found)} → ${opts.expected} (${opts.fix})`;
  }
}

/**
 * Report one file, using the shared severity policy (`outcome`) — the CLI owns
 * presentation and the counters, the manifest owns what is fatal.
 *
 * @param owned the destination is sepia's own file, so its mere existence means
 *              sepia installed it. Without that (or an install block) a file
 *              with no marker at all is only "not installed here".
 */
function report(opts: {
  label: string;
  path: string;
  declared: MarkerKind[];
  expected: string;
  fix: string;
  phase: "source" | "installed";
  owned?: boolean;
}) {
  const v = verdict(opts.path, opts.declared, opts.expected);
  const severity = outcome(v, {
    phase: opts.phase,
    expected: opts.expected,
    owned: opts.owned,
  });
  const detail = describe(v, opts);
  if (severity === "ok") {
    console.log(`  ✅ ${opts.label}: ${detail}`);
    return;
  }
  if (severity === "warn") {
    // Two kinds of warning, both "nothing to fix here": never installed, or a
    // copy newer than the server because the deploy hasn't happened.
    if (isAheadOfServer(v, { phase: opts.phase, expected: opts.expected })) {
      ahead++;
    } else {
      notInstalled++;
    }
    console.log(`  ⚠ ${opts.label}: ${detail}`);
    return;
  }
  console.error(`  ❌ ${opts.label}: ${detail}`);
  failures++;
}

// ── Source: this repo's own files, against DOCS_VERSION ───────────────────
// No network needed, so this half is CI-able and is the part that catches
// "bumped the version, forgot to stamp".
console.log(`repo docs version (DOCS_VERSION): ${DOCS_VERSION}`);
console.log("\nsource files:");
for (const doc of AGENT_DOCS) {
  report({
    label: doc.path,
    path: resolve(ROOT, doc.path),
    declared: doc.markers,
    expected: DOCS_VERSION,
    fix: "run bun run scripts/stamp-docs-version.ts",
    phase: "source",
  });
}

if (SOURCE_ONLY) {
  console.log(
    failures === 0
      ? "\nRepo docs are internally consistent."
      : `\n${failures} repo doc(s) wrong — run bun run scripts/stamp-docs-version.ts`,
  );
  process.exit(failures > 0 ? 1 : 0);
}

// ── Installed copies: against what the server actually serves ─────────────
const res = await fetch(`${BASE}/version`);
if (!res.ok) {
  console.error(`\nerror: ${BASE}/version returned ${res.status}`);
  process.exit(1);
}
const info = (await res.json()) as { docs_version?: string };
const served = info.docs_version ?? "unknown";
console.log(`\nserved docs version: ${served} (${BASE})`);
console.log("installed copies:");

// De-duplicate by real path: ~/.claude/skills/sepia is a symlink to
// ~/.agents/skills/sepia on this machine, and reporting one file twice adds
// noise, not information.
const seen = new Map<string, string[]>();
const order: { real: string; label: string }[] = [];
for (const entry of INSTALLED) {
  let real: string;
  try {
    real = realpathSync(entry.path);
  } catch {
    real = entry.path; // missing — keep it as its own entry to warn once
  }
  const alias = seen.get(real);
  if (alias) {
    alias.push(entry.label);
    continue;
  }
  seen.set(real, []);
  order.push({ real, label: entry.label });
}

for (const { real, label } of order) {
  const entry = INSTALLED.find((e) => {
    try {
      return realpathSync(e.path) === real;
    } catch {
      return e.path === real;
    }
  })!;
  const aliases = seen.get(real) ?? [];
  const name =
    aliases.length > 0 ? `${label} (also ${aliases.join(", ")})` : label;
  report({
    label: name,
    path: real,
    declared: declaredFor(entry.source),
    expected: served,
    fix: "run bash scripts/install-skill.sh",
    phase: "installed",
    owned: entry.owned,
  });
}

const notes: string[] = [];
if (ahead > 0) notes.push(`${ahead} ahead of the server (deploy pending?)`);
if (notInstalled > 0) notes.push(`${notInstalled} not installed`);
console.log(
  failures === 0
    ? `\nNo stale copies.${notes.length > 0 ? ` (${notes.join("; ")})` : ""}`
    : `\n${failures} stale or inconsistent copy(ies) — see above.`,
);
process.exit(failures > 0 ? 1 : 0);
