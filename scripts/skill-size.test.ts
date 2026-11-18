/**
 * Byte ceilings for the artifacts that are loaded into a model's context.
 *
 * WHY. These files are not documentation, they are prompt. Every one of them
 * costs tokens on every request (the always-on block and the MCP `instructions`
 * field) or on every skill trigger (SKILL.md), and the only thing that keeps a
 * contract from growing back to where it was is a test that fails when it does.
 *
 * Measured 2026-11-14, before the diet:
 *   always-on/*.md        6,600 each   (six hand-maintained copies of one text)
 *   SKILL.md             13,471
 *   MEMORY_CONTRACT      11,179
 *   MEMORY_CONTRACT_QUICK 9,603
 *   → ~4.5k tokens of duplicated contract before a single memory was read.
 *
 * The fix was to relocate detail into `references/`, which load on demand, and
 * to generate the six always-on files from one body. These ceilings guard the
 * result: they are a tripwire, not a target to squeeze against.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MEMORY_CONTRACT, MEMORY_CONTRACT_QUICK } from "@sepia/shared/types";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bytes = (p: string) => statSync(p).size;
const rel = (p: string) => p.replace(`${ROOT}/`, "");

const CEILINGS = {
  /** Auto-loaded on EVERY request by its editor. Hardest ceiling in the repo. */
  alwaysOn: 2_800,
  /** Loaded whenever the skill triggers. */
  skill: 6_000,
  /** Injected into the system prompt via the MCP `instructions` field. */
  contract: 4_000,
  /** The paste-into-a-web-AI block. Promised "quick" by its own name. */
  contractQuick: 1_400,
} as const;

describe("prompt budget", () => {
  const alwaysOnDir = join(ROOT, "skills/sepia/always-on");
  const files = readdirSync(alwaysOnDir).filter((f) =>
    statSync(join(alwaysOnDir, f)).isFile(),
  );

  test("every always-on file stays under the ceiling", () => {
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const path = join(alwaysOnDir, file);
      expect({ file, over: bytes(path) > CEILINGS.alwaysOn }).toEqual({
        file,
        over: false,
      });
    }
  });

  /**
   * The six files exist because six editors read six different paths. They must
   * carry the same rules — a divergence is a rule that silently applies in one
   * editor and not another, which is unfixable from the outside.
   */
  test("the always-on variants carry an identical body", () => {
    const bodies = files.map((file) => {
      const text = readFileSync(join(alwaysOnDir, file), "utf8");
      // Drop YAML frontmatter, the heading, and the version marker: the only
      // parts that are allowed to differ per editor.
      return text
        .replace(/^---\n[\s\S]*?\n---\n/, "")
        .replace(/^#{1,2} .*$/m, "")
        .replace(/^<!-- sepia-docs-version:[^>]*-->$/m, "")
        .trim();
    });
    expect(new Set(bodies).size).toBe(1);
  });

  test("SKILL.md stays under the ceiling", () => {
    expect(bytes(join(ROOT, "skills/sepia/SKILL.md"))).toBeLessThanOrEqual(
      CEILINGS.skill,
    );
  });

  test("the MCP contract stays under the ceiling", () => {
    expect(MEMORY_CONTRACT.length).toBeLessThanOrEqual(CEILINGS.contract);
    expect(MEMORY_CONTRACT_QUICK.length).toBeLessThanOrEqual(
      CEILINGS.contractQuick,
    );
  });

  /**
   * The reference files exist so detail can be RELOCATED, not deleted. If one of
   * them is far bigger than the others it has become a second SKILL.md that
   * nobody budgets for. `tools.md` is the exception and gets its own, looser
   * ceiling: it is generated from the schemas, one entry per tool, and is only
   * read when exact arguments are needed.
   */
  test("no reference file grows past its ceiling", () => {
    const refDir = join(ROOT, "skills/sepia/references");
    for (const file of readdirSync(refDir)) {
      const path = join(refDir, file);
      if (!statSync(path).isFile()) continue;
      const ceiling = file === "tools.md" ? 12_000 : CEILINGS.skill;
      expect({ file, over: bytes(path) > ceiling }).toEqual({
        file,
        over: false,
      });
    }
  });

  /**
   * Every `references/…` a doc links to must exist. A broken "load on demand"
   * pointer is worse than no pointer: the model is told the detail is one hop
   * away and then finds nothing.
   */
  test("every referenced file exists", () => {
    const skillDir = join(ROOT, "skills/sepia");
    const doc = readFileSync(join(skillDir, "SKILL.md"), "utf8");
    const links = [...doc.matchAll(/references\/[a-z-]+\.md/g)].map((m) => m[0]);
    expect(links.length).toBeGreaterThan(0);
    const missing = [...new Set(links)].filter(
      (link) => !existsSync(join(skillDir, link)),
    );
    expect(missing).toEqual([]);
  });
});
