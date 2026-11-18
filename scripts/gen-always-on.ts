/**
 * Generates the six `skills/sepia/always-on/*` files from ONE body.
 *
 * WHY. Those files were hand-maintained copies of the same ~6.6 KB contract,
 * differing only in a heading and two lines of install framing (`diff
 * agents.md opencode.md` produced two hunks). Five of the six were pure
 * maintenance surface, and all six are auto-loaded into every request by their
 * editor — so the duplication was paid for in context on every turn, not just
 * in the repo.
 *
 * One body (`skills/sepia/_source/always-on.md`) + a heading + the markers each
 * editor needs = six files that cannot drift.
 *
 * The version comes from `DOCS_VERSION`, the same constant
 * `scripts/stamp-docs-version.ts` writes with, so running either one produces
 * byte-identical output and the checker never sees them disagree.
 *
 * Run: bun run scripts/gen-always-on.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DOCS_VERSION } from "@sepia/shared/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const BODY_PATH = resolve(ROOT, "skills/sepia/_source/always-on.md");
const OUT_DIR = resolve(ROOT, "skills/sepia/always-on");

/** Where each file is installed, kept beside the file it describes. */
interface Target {
  file: string;
  heading: string;
  /** YAML frontmatter, for the editors that read one. */
  frontmatter?: Record<string, string>;
}

const TARGETS: Target[] = [
  {
    file: "agents.md",
    heading: "## Sepia memory (always-on) — AGENTS.md (Codex / OpenCode / generic)",
  },
  {
    file: "claude.md",
    heading: "## Sepia memory (always-on) — Claude Code",
  },
  {
    file: "opencode.md",
    heading: "## Sepia memory (always-on) — OpenCode",
  },
  {
    file: "zed.md",
    heading: "## Sepia memory (always-on) — Zed",
  },
  {
    file: "vscode.instructions.md",
    heading: "# Sepia memory (always-on) — VS Code / Copilot",
    frontmatter: {
      version: `"${DOCS_VERSION}"`,
      applyTo: '"**"',
      description:
        '"Sepia memory — MANDATORY recall before work, persist after. Always-on."',
    },
  },
  {
    file: "cursor.mdc",
    heading: "# Sepia memory (always-on) — Cursor",
    frontmatter: {
      version: `"${DOCS_VERSION}"`,
      description:
        '"Sepia memory — MANDATORY recall before work, persist after. Always-on."',
      alwaysApply: "true",
    },
  },
];

const body = readFileSync(BODY_PATH, "utf8").trim();

for (const target of TARGETS) {
  const parts: string[] = [];
  if (target.frontmatter) {
    const yaml = Object.entries(target.frontmatter)
      .map(([k, val]) => `${k}: ${val}`)
      .join("\n");
    parts.push(`---\n${yaml}\n---`, "");
  }
  parts.push(target.heading, "", `<!-- sepia-docs-version: ${DOCS_VERSION} -->`, "", body, "");
  writeFileSync(resolve(OUT_DIR, target.file), parts.join("\n"));
}

console.log(
  `wrote ${TARGETS.length} always-on files from ${BODY_PATH.replace(`${ROOT}/`, "")}`,
);
