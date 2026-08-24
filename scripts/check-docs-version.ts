/**
 * Checks installed sepia docs against the served /version endpoint and
 * reports which copies are stale. Exits non-zero if any are.
 *
 * Usage:
 *   bun run scripts/check-docs-version.ts            # against https://sepia.fly.dev
 *   bun run scripts/check-docs-version.ts http://localhost:8080
 */
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const BASE = process.argv[2] ?? "https://sepia.fly.dev";

const INSTALLED: { label: string; path: string }[] = [
  {
    label: "VS Code prompts",
    path: join(homedir(), ".config/Code/User/prompts/sepia.instructions.md"),
  },
  { label: "Cursor rules", path: join(homedir(), ".cursor/rules/sepia.mdc") },
  {
    label: "Claude Code CLAUDE.md",
    path: join(homedir(), ".claude/CLAUDE.md"),
  },
  { label: "Codex AGENTS.md", path: join(homedir(), ".codex/AGENTS.md") },
  {
    label: "OpenCode AGENTS.md",
    path: join(homedir(), ".config/opencode/AGENTS.md"),
  },
  { label: "Repo AGENTS.md", path: join(process.cwd(), "AGENTS.md") },
];

/**
 * Read the version marker from a file. Two kinds:
 *   - shared docs version: `sepia-docs-version` comment / `Docs version` line
 *     (claude/agents/opencode/zed/AGENTS.md/llms.txt)
 *   - own version: `version:` frontmatter key (SKILL.md, vscode, cursor —
 *     these are cp'd whole, so their own version IS the docs version)
 */
function readVersion(path: string): string | null {
  if (!existsSync(path)) return null;
  const text = readFileSync(path, "utf8");
  const comment = text.match(/sepia-docs-version:\s*([0-9.]+)/);
  if (comment) return comment[1] ?? null;
  const line = text.match(/^Docs version:\s*([0-9.]+)/m);
  if (line) return line?.[1] ?? null;
  const fm = text.match(/^version:\s*"([^"]+)"/m);
  return fm?.[1] ?? null;
}

const res = await fetch(`${BASE}/version`);
if (!res.ok) {
  console.error(`error: ${BASE}/version returned ${res.status}`);
  process.exit(1);
}
const info = (await res.json()) as { docs_version?: string };
const served = info.docs_version ?? "unknown";
console.log(`served docs version: ${served} (${BASE})`);

let stale = 0;
for (const { label, path } of INSTALLED) {
  const v = readVersion(path);
  if (v === null) {
    console.log(`  ⚠ ${label}: no version marker (not installed?)`);
    continue;
  }
  if (v === served) {
    console.log(`  ✅ ${label}: ${v}`);
  } else {
    console.log(
      `  ❌ ${label}: ${v} → ${served} (run bash scripts/install-skill.sh)`,
    );
    stale++;
  }
}

console.log(
  stale === 0
    ? "\nAll installed copies are current."
    : `\n${stale} stale copy(ies) — re-run the installer.`,
);
process.exit(stale > 0 ? 1 : 0);
