/**
 * Stamps DOCS_VERSION into every agent-facing doc file so installed copies
 * can be checked for staleness against the served /version endpoint.
 * Idempotent — safe to re-run. Run: bun run scripts/stamp-docs-version.ts
 *
 * WHICH files, and which markers each must carry, lives in
 * scripts/docs-manifest.ts — shared with check-docs-version.ts (verify) and
 * smoke.ts (pre-deploy check), so the stamp can never target a file the
 * checker does not look at, or vice versa.
 *
 * Marker formats:
 *   - `<!-- sepia-docs-version: X -->` after the sepia heading (claude, agents,
 *     opencode, zed, vscode, cursor, AGENTS.md)
 *   - `Docs version: X` at the end (llms.txt)
 *   - `version: "X"` inside the leading YAML frontmatter (SKILL.md,
 *     vscode.instructions.md, cursor.mdc)
 *
 * The frontmatter key IS stamped. It used to be treated as each file's "own
 * version" and left alone — but nothing owned it: no skill system reads or
 * bumps it, so it froze at "1.0.0" while every body marker moved on. VS Code,
 * Cursor and the skill therefore advertised 1.0.0 forever. A version that no
 * process maintains is not a version, it is a lie: one concept, DOCS_VERSION.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DOCS_VERSION } from "@sepia/shared/types";
import {
  AGENT_DOCS,
  WRITE_PATTERNS,
  frontmatterBlock,
  readText,
  verdictOf,
  type MarkerKind,
} from "./docs-manifest.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

/** Write DOCS_VERSION into one marker kind. Throws if the anchor is missing. */
function writeMarker(text: string, path: string, kind: MarkerKind): string {
  if (kind === "comment") {
    const marker = `<!-- sepia-docs-version: ${DOCS_VERSION} -->`;
    // Every marker LINE is rewritten, not just the first. Leaving later ones
    // frozen is the drift this script exists to prevent — and the checker then
    // fails on a disagreement the stamp could not clear. (`match` rather than
    // `test`: a /g regex's lastIndex makes repeated test() calls stateful.)
    if (text.match(WRITE_PATTERNS.comment)) {
      return text.replace(WRITE_PATTERNS.comment, () => marker);
    }
    // After the `## Sepia memory` heading when present (AGENTS.md has earlier
    // headings), else after the first heading. NOTE: `m` flag — `^` must match
    // at any line start, not just the string start.
    const heading = /^(## Sepia memory.*\n)/m;
    if (heading.test(text)) {
      return text.replace(heading, (_m, h: string) => `${h}${marker}\n`);
    }
    const firstHeading = /^(#+ .*\n)/m;
    if (firstHeading.test(text)) {
      return text.replace(firstHeading, (_m, h: string) => `${h}${marker}\n`);
    }
    throw new Error(`stamp failed: no heading to anchor a marker in ${path}`);
  }
  if (kind === "line") {
    const line = `Docs version: ${DOCS_VERSION}`;
    if (text.match(WRITE_PATTERNS.line)) {
      return text.replace(WRITE_PATTERNS.line, () => line);
    }
    return `${text.replace(/\n*$/, "")}\n\n${line}\n`;
  }
  const block = frontmatterBlock(text);
  if (!block) throw new Error(`stamp failed: no YAML frontmatter in ${path}`);
  if (!WRITE_PATTERNS.frontmatter.test(block)) {
    throw new Error(`stamp failed: frontmatter has no version: key in ${path}`);
  }
  // Function replacements, never strings: `$&`, `$'`, `` $` `` and `$$` in a
  // string replacement are substitution patterns, so a frontmatter containing
  // one would splice the block into itself and corrupt the file.
  const stamped = block.replace(
    WRITE_PATTERNS.frontmatter,
    () => `version: "${DOCS_VERSION}"`,
  );
  return text.replace(block, () => stamped);
}

for (const doc of AGENT_DOCS) {
  const full = resolve(ROOT, doc.path);
  const before = readFileSync(full, "utf8");
  let after = before;
  for (const kind of doc.markers) after = writeMarker(after, full, kind);

  // Verify IN MEMORY, before anything is written. Every declared marker must be
  // present and none may disagree — and a file the checker would reject must
  // never reach the disk at all, which checking after the write cannot promise.
  const result = verdictOf(
    { ...readText(after), exists: true },
    doc.markers,
    DOCS_VERSION,
  );
  if (result.state !== "ok") {
    const detail =
      result.state === "conflict"
        ? `disagreeing markers (${[...new Set(result.found.map((m) => m.version))].join(", ")})`
        : result.state === "unmarked"
          ? `missing ${result.missing.join(", ")}`
          : result.state;
    throw new Error(`stamp failed for ${doc.path}: would leave ${detail}`);
  }

  // Write only on a real change: a no-op write churns mtimes and makes
  // "did the stamp actually do anything?" unanswerable.
  const changed = after !== before;
  if (changed) writeFileSync(full, after);
  console.log(
    `${changed ? "stamped" : "already current:"} ${doc.path} → ${DOCS_VERSION} (${doc.markers.join(" + ")})`,
  );
}

console.log(`\nAll agent-facing docs stamped with version ${DOCS_VERSION}.`);
