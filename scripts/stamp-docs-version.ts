/**
 * Stamps DOCS_VERSION into every agent-facing doc file so installed copies
 * can be checked for staleness against the served /version endpoint.
 * Idempotent — safe to re-run. Run: bun run scripts/stamp-docs-version.ts
 *
 * Marker formats:
 *   - YAML frontmatter files (SKILL.md, vscode, cursor): `version: "X"`
 *   - plain markdown (claude, agents, opencode, zed, AGENTS.md):
 *     `<!-- sepia-docs-version: X -->` after the sepia heading
 *   - llms.txt: `Docs version: X` at the end
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DOCS_VERSION } from "@sepia/shared";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

/** Files with YAML frontmatter — stamp a `version:` key. */
const FRONTMATTER = [
  "skills/sepia/SKILL.md",
  "skills/sepia/always-on/vscode.instructions.md",
  "skills/sepia/always-on/cursor.mdc",
];

/** Plain markdown — stamp an HTML comment after the sepia heading. */
const COMMENT = [
  "skills/sepia/always-on/claude.md",
  "skills/sepia/always-on/agents.md",
  "skills/sepia/always-on/opencode.md",
  "skills/sepia/always-on/zed.md",
  "AGENTS.md",
];

/** llms.txt — stamp a plain line at the end. */
const LINE = ["llms.txt"];

function stamp(path: string, kind: "frontmatter" | "comment" | "line") {
  const full = resolve(ROOT, path);
  let text = readFileSync(full, "utf8");
  if (kind === "frontmatter") {
    const re = /^version:\s*"[^"]*"$/m;
    if (re.test(text)) {
      text = text.replace(re, `version: "${DOCS_VERSION}"`);
    } else {
      text = text.replace(/^---\n/, `---\nversion: "${DOCS_VERSION}"\n`);
    }
  } else if (kind === "comment") {
    const marker = `<!-- sepia-docs-version: ${DOCS_VERSION} -->`;
    const re = /<!-- sepia-docs-version: [^>]* -->/;
    if (re.test(text)) {
      text = text.replace(re, marker);
    } else {
      // After the `## Sepia memory` heading when present (AGENTS.md has
      // earlier headings), else after the first heading. NOTE: `m` flag —
      // `^` must match at any line start, not just the string start.
      const heading = /^(## Sepia memory.*\n)/m;
      if (heading.test(text)) {
        text = text.replace(heading, `$1${marker}\n`);
      } else {
        text = text.replace(/^(#+ .*\n)/m, `$1${marker}\n`);
      }
    }
  } else {
    const line = `Docs version: ${DOCS_VERSION}`;
    const re = /^Docs version: .*$/m;
    if (re.test(text)) {
      text = text.replace(re, line);
    } else {
      text = `${text.replace(/\n*$/, "")}\n\n${line}\n`;
    }
  }
  writeFileSync(full, text);
  // Verify the marker actually landed — a silent no-op would defeat the
  // whole point of versioning.
  const check = readFileSync(full, "utf8");
  const ok =
    kind === "frontmatter"
      ? check.includes(`version: "${DOCS_VERSION}"`)
      : kind === "comment"
        ? check.includes(`sepia-docs-version: ${DOCS_VERSION}`)
        : check.includes(`Docs version: ${DOCS_VERSION}`);
  if (!ok) {
    throw new Error(`stamp failed: marker not found in ${path}`);
  }
  console.log(`stamped ${path} → ${DOCS_VERSION}`);
}

for (const p of FRONTMATTER) stamp(p, "frontmatter");
for (const p of COMMENT) stamp(p, "comment");
for (const p of LINE) stamp(p, "line");
console.log(`\nAll docs stamped with version ${DOCS_VERSION}.`);
