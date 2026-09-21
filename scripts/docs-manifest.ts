/**
 * The single list of agent-facing doc files — and HOW each one exposes the
 * version. Three writers/readers share it:
 *
 *   scripts/stamp-docs-version.ts  → writes DOCS_VERSION into every marker
 *   scripts/check-docs-version.ts  → verifies every marker equals it
 *   scripts/smoke.ts               → same check, before a deploy
 *
 * WHY A MANIFEST. There is ONE version concept (`DOCS_VERSION`). A file never
 * has a "version of its own": that idea is what let the `version:` YAML key in
 * SKILL.md / vscode.instructions.md / cursor.mdc sit at "1.0.0" forever while
 * every other channel refreshed — nothing read it, nothing wrote it, and the
 * checker reported the *first* marker it found (the fresh body comment), so the
 * freeze stayed invisible. Declaring the markers here means a file cannot be
 * stamped without also being checked, and the stamp's file list cannot drift
 * from the checker's.
 */
import { readFileSync } from "node:fs";

/** How a file exposes its version. A file may use more than one. */
export type MarkerKind =
  /** `<!-- sepia-docs-version: X -->` anywhere in the body. */
  | "comment"
  /** `Docs version: X` on its own line (llms.txt). */
  | "line"
  /** `version: "X"` inside the leading `---` YAML frontmatter block. */
  | "frontmatter";

export interface AgentDoc {
  /** Repo-relative path. */
  path: string;
  /** Every marker this file MUST carry. Missing marker = failure. */
  markers: MarkerKind[];
}

export const AGENT_DOCS: AgentDoc[] = [
  { path: "skills/sepia/SKILL.md", markers: ["frontmatter"] },
  { path: "skills/sepia/always-on/claude.md", markers: ["comment"] },
  { path: "skills/sepia/always-on/agents.md", markers: ["comment"] },
  { path: "skills/sepia/always-on/opencode.md", markers: ["comment"] },
  { path: "skills/sepia/always-on/zed.md", markers: ["comment"] },
  {
    path: "skills/sepia/always-on/vscode.instructions.md",
    markers: ["frontmatter", "comment"],
  },
  {
    path: "skills/sepia/always-on/cursor.mdc",
    markers: ["frontmatter", "comment"],
  },
  { path: "AGENTS.md", markers: ["comment"] },
  { path: "llms.txt", markers: ["line"] },
];

export interface FoundMarker {
  kind: MarkerKind;
  /** Human label for check output. */
  label: string;
  version: string;
}

// ── Marker patterns ────────────────────────────────────────────────────────
// A marker LINE: the whole line is the marker and nothing else. Define these
// ONCE — the stamp writes with them, the checker reads with them, and drift
// between the two is a bug in both directions (the stamp once matched with a
// narrower pattern than the checker, so `<!--sepia-docs-version:1.0.0-->`
// was invisible to it: it inserted a SECOND marker, printed success, and left
// a disagreement it could never repair).
//
// Whole-line anchoring also means a marker QUOTED INSIDE PROSE is not a match,
// so the stamp can never silently rewrite an example into a false version.
//
// Invariant: WRITE matches at least everything READ matches. READ is strict
// (a real version), WRITE is broad so it can also repair a malformed one.
const MARKER_LINE = /^[ \t]*<!--\s*sepia-docs-version:[^>]*-->[ \t]*$/gm;
const MARKER_LINE_VALUE =
  /^[ \t]*<!--\s*sepia-docs-version:\s*([0-9][0-9.]*)\s*-->[ \t]*$/gm;
const DOCS_LINE = /^[ \t]*Docs version:.*$/gm;
const DOCS_LINE_VALUE = /^[ \t]*Docs version:[ \t]*([0-9][0-9.]*)[ \t]*$/gm;
const FRONTMATTER_BLOCK_RE = /^---\n[\s\S]*?\n---\n/;
const FRONTMATTER_KEY_RE = /^version:\s*"([^"]+)"\s*$/m;
const FRONTMATTER_KEY = /^version:\s*".*"$/m;

/** Patterns the STAMP rewrites with. Exported so there is exactly one copy. */
export const WRITE_PATTERNS = {
  comment: MARKER_LINE,
  line: DOCS_LINE,
  frontmatter: FRONTMATTER_KEY,
} as const;

/** The leading YAML frontmatter block, or null when the file has none. */
export function frontmatterBlock(text: string): string | null {
  return text.match(FRONTMATTER_BLOCK_RE)?.[0] ?? null;
}

/**
 * In-band evidence that sepia IS installed in a file. Two signals, because the
 * installer itself trusts both:
 *   - its `<!-- sepia:start -->` block marker, and
 *   - the `## Sepia memory` heading, which is how `remote-install.sh` recognises
 *     and migrates a LEGACY block that an older installer left unmarked.
 * Requiring the block marker alone is too narrow. Strip the HTML comments out of
 * a `CLAUDE.md` (a formatter or a rewrite does this in one go) and the file
 * still holds sepia's entire block, yet "not installed" would be reported — and
 * a wrong diagnosis at warn level is how the original freeze survived.
 */
const INSTALL_EVIDENCE =
  /^[ \t]*(?:<!-- sepia:start -->|#{1,6}[ \t]+Sepia memory)/m;

export interface ReadResult {
  /**
   * Whether the file could be read at all. An EXISTING file with no markers is
   * a different (and worse) thing than a file that is not there — collapsing
   * the two is how a deleted marker became a silent "not installed" warning.
   */
  exists: boolean;
  /**
   * Whether anything in the file proves sepia was ever installed here (see
   * INSTALL_EVIDENCE). This is what separates "this editor was never set up"
   * from "someone deleted the version marker".
   */
  hasInstallEvidence: boolean;
  /**
   * Every version marker actually present, grouped by kind (comment, line,
   * frontmatter). Deliberately ALL of them (not the first): a file whose
   * markers disagree is the bug we are hunting, so callers must be able to see
   * the disagreement.
   */
  markers: FoundMarker[];
}

/**
 * Read the markers out of file TEXT. Pure — the stamp verifies what it is about
 * to write with this, before it writes it.
 */
export function readText(text: string): Omit<ReadResult, "exists"> {
  const markers: FoundMarker[] = [];
  for (const m of text.matchAll(MARKER_LINE_VALUE)) {
    markers.push({ kind: "comment", label: "body marker", version: m[1]! });
  }
  for (const m of text.matchAll(DOCS_LINE_VALUE)) {
    markers.push({ kind: "line", label: "docs line", version: m[1]! });
  }
  const fmVersion = frontmatterBlock(text)?.match(FRONTMATTER_KEY_RE)?.[1];
  if (fmVersion) {
    markers.push({
      kind: "frontmatter",
      label: "frontmatter",
      version: fmVersion,
    });
  }
  return { hasInstallEvidence: INSTALL_EVIDENCE.test(text), markers };
}

export function readMarkers(path: string): ReadResult {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return { exists: false, hasInstallEvidence: false, markers: [] };
  }
  return { exists: true, ...readText(text) };
}

/**
 * Verdict for one file against the expected version. Three distinct failure
 * states, because they need different words and different severity:
 *   - `absent`   — the file is not there (not installed in this editor)
 *   - `unmarked` — the file IS there but lacks a marker it declares, including
 *                  having no marker at all. This is the dangerous one: a
 *                  deleted marker used to be indistinguishable from "not
 *                  installed", so it exited 0 and stayed green forever.
 *   - `conflict` — its markers disagree with each other. Never merges into
 *                  "current" by picking the first marker.
 */
export type Verdict =
  | { state: "ok"; version: string; found: FoundMarker[] }
  | { state: "absent" }
  | {
      state: "unmarked";
      missing: MarkerKind[];
      found: FoundMarker[];
      hasInstallEvidence: boolean;
    }
  | { state: "conflict"; found: FoundMarker[] }
  | { state: "stale"; found: FoundMarker[] };

/** Verdict from an already-read file — pure, so it can run before a write. */
export function verdictOf(
  read: ReadResult,
  declared: MarkerKind[],
  expected: string,
): Verdict {
  const { exists, hasInstallEvidence, markers: found } = read;
  if (!exists) return { state: "absent" };
  // Zero markers on an existing file is NOT "fine, nothing to compare" — the
  // file declares markers, so it is missing every one of them.
  const present = new Set(found.map((m) => m.kind));
  const missing = declared.filter((k) => !present.has(k));
  const versions = new Set(found.map((m) => m.version));
  if (versions.size > 1) return { state: "conflict", found };
  if (missing.length > 0) {
    return { state: "unmarked", missing, found, hasInstallEvidence };
  }
  if (found[0]!.version !== expected) return { state: "stale", found };
  return { state: "ok", version: found[0]!.version, found };
}

export function verdict(
  path: string,
  declared: MarkerKind[],
  expected: string,
): Verdict {
  return verdictOf(readMarkers(path), declared, expected);
}

export type Severity = "ok" | "warn" | "fail";

/**
 * An installed copy that is AHEAD of the served version: normal between
 * `install-skill.sh` and `fly deploy`, and the only kind of staleness that is
 * not a defect. One predicate, used by both the severity decision and the
 * message, so the two can never disagree about the same file.
 */
export function isAheadOfServer(
  v: Verdict,
  opts: { phase: "source" | "installed"; expected: string },
): boolean {
  return (
    v.state === "stale" &&
    opts.phase === "installed" &&
    compareVersions(v.found[0]!.version, opts.expected) > 0
  );
}

/**
 * The severity policy — THE one place that decides whether a verdict is fatal.
 *
 * Extracted from the CLI so it can be unit-tested: every hole this mechanism has
 * had was a severity decision nobody exercised. A deleted marker counted as
 * "not installed" (warn); then it survived one phase over, still as a warn;
 * then again one signal narrower (the file kept sepia's block but lost every
 * HTML comment). Each time the fix was to widen the EVIDENCE, not to move the
 * line between warn and fail.
 *
 * @param phase   "source" = a file this repo owns and must be stamped;
 *                "installed" = a copy in an editor directory on this machine.
 * @param owned   the destination is sepia's own file (name or folder), so its
 *                mere existence means sepia put it there.
 */
export function outcome(
  v: Verdict,
  opts: { phase: "source" | "installed"; expected: string; owned?: boolean },
): Severity {
  const { phase, expected, owned = false } = opts;
  switch (v.state) {
    case "ok":
      return "ok";
    case "absent":
      return phase === "source" ? "fail" : "warn";
    case "conflict":
      return "fail";
    case "unmarked":
      if (v.found.length > 0) return "fail"; // lost one of several
      if (phase === "source") return "fail";
      // No markers at all: only innocent if nothing says sepia was here.
      return v.hasInstallEvidence || owned ? "fail" : "warn";
    case "stale":
      return isAheadOfServer(v, { phase, expected }) ? "warn" : "fail";
  }
}

/** `frontmatter 1.0.0, body marker 1.9.0` — for error output. */
export function describeMarkers(found: FoundMarker[]): string {
  return (
    found.map((m) => `${m.label} ${m.version}`).join(", ") ||
    "no version marker"
  );
}

/**
 * Numeric compare of dotted versions, so 1.10.0 beats 1.9.0 (a string compare
 * would not). Installed copies can legitimately be AHEAD of the served version
 * between `install-skill.sh` and `fly deploy` — that is not staleness.
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}
