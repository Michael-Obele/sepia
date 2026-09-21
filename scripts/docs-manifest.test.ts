/**
 * Unit tests for the version-marker model (`docs-manifest.ts`). Pure file I/O —
 * no server, no DB.
 *
 * These exist because a hole here is invisible in production: a marker that
 * quietly stops being recognised was reported as "not installed" and exited 0 —
 * the exact class of silent lie this whole mechanism was built to remove. The
 * pattern-invariant tests at the bottom pin the stamp's write patterns to the
 * checker's read patterns, so they cannot drift apart again.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AGENT_DOCS,
  WRITE_PATTERNS,
  compareVersions,
  frontmatterBlock,
  outcome,
  readMarkers,
  readText,
  verdict,
  verdictOf,
  type MarkerKind,
  type Verdict,
} from "./docs-manifest.ts";

const DIR = mkdtempSync(join(tmpdir(), "sepia-docs-manifest-"));
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const COMMENT = "<!-- sepia-docs-version: 1.9.0 -->";

/** Write a throwaway fixture and return its path. */
function fixture(name: string, text: string): string {
  const path = join(DIR, name);
  writeFileSync(path, text);
  return path;
}

describe("readMarkers", () => {
  test("finds a body marker on its own line", () => {
    const path = fixture("comment.md", `# Doc\n\n${COMMENT}\n\nbody\n`);
    expect(readMarkers(path)).toEqual({
      exists: true,
      hasInstallEvidence: false,
      markers: [{ kind: "comment", label: "body marker", version: "1.9.0" }],
    });
  });

  test("reports the installer's block as evidence sepia was here", () => {
    const path = fixture(
      "block.md",
      "<!-- sepia:start -->\n## Sepia memory\nno marker\n<!-- sepia:end -->\n",
    );
    expect(readMarkers(path).hasInstallEvidence).toBe(true);
    expect(readMarkers(path).markers).toEqual([]);
  });

  test("a stripped block heading alone is still evidence (legacy installs)", () => {
    // remote-install.sh recognises a legacy unmarked block by this heading. If
    // the checker does not, stripping HTML comments from an installed CLAUDE.md
    // makes the file look like sepia was never there.
    const path = fixture(
      "legacy.md",
      "# My notes\n\n## Sepia memory (always-on) — Claude Code\n\nYou are connected to the user's personal Sepia memory server.\n",
    );
    expect(readMarkers(path).hasInstallEvidence).toBe(true);
    expect(readMarkers(path).markers).toEqual([]);
  });

  test("finds a marker written without spaces", () => {
    const path = fixture(
      "tight.md",
      "# Doc\n<!--sepia-docs-version:1.9.0-->\n",
    );
    expect(readMarkers(path).markers.map((m) => m.version)).toEqual(["1.9.0"]);
  });

  test("finds the `Docs version:` line", () => {
    const path = fixture("llms.txt", "# llms\n\nDocs version: 1.9.0\n");
    expect(readMarkers(path).markers).toEqual([
      { kind: "line", label: "docs line", version: "1.9.0" },
    ]);
  });

  test("finds the version inside YAML frontmatter", () => {
    const path = fixture(
      "skill.md",
      '---\nversion: "1.9.0"\nname: x\n---\n\nbody\n',
    );
    expect(readMarkers(path).markers).toEqual([
      { kind: "frontmatter", label: "frontmatter", version: "1.9.0" },
    ]);
  });

  test("returns every marker, not just the first", () => {
    const path = fixture(
      "two.md",
      `---\nversion: "1.0.0"\n---\n\n# Doc\n${COMMENT}\n`,
    );
    expect(
      readMarkers(path).markers.map((m) => `${m.kind}=${m.version}`),
    ).toEqual(["comment=1.9.0", "frontmatter=1.0.0"]);
  });

  test("a marker quoted inside prose is not a marker", () => {
    const path = fixture(
      "prose.md",
      `# Doc\n\nThe form is \`${COMMENT}\` — never hand-edit it.\n`,
    );
    expect(readMarkers(path).markers).toEqual([]);
  });

  test("a missing file reports exists: false", () => {
    expect(readMarkers(join(DIR, "nope.md"))).toEqual({
      exists: false,
      hasInstallEvidence: false,
      markers: [],
    });
  });
});

describe("verdict", () => {
  test("an EXISTING file with no marker is unmarked — not 'not installed'", () => {
    // The regression this File guards: this case used to be indistinguishable
    // from an absent file, so it warned and exited 0 forever.
    const path = fixture("unmarked.md", "# Doc with no marker at all\n");
    const v = verdict(path, ["comment"], "1.9.0");
    expect(v.state).toBe("unmarked");
    expect(v.state === "unmarked" && v.missing).toEqual(["comment"]);
  });

  test("a file missing one of several declared markers is unmarked", () => {
    const path = fixture("half.md", '---\nversion: "1.9.0"\n---\n\n# Doc\n');
    const v = verdict(path, ["frontmatter", "comment"], "1.9.0");
    expect(v.state).toBe("unmarked");
    expect(v.state === "unmarked" && v.missing).toEqual(["comment"]);
  });

  test("disagreeing markers are a conflict", () => {
    // The original VS Code bug: frontmatter frozen at 1.0.0 beside a current
    // body marker, reported as "current" because only the first was read.
    const path = fixture(
      "conflict.md",
      `---\nversion: "1.0.0"\n---\n\n# Doc\n${COMMENT}\n`,
    );
    expect(verdict(path, ["frontmatter", "comment"], "1.9.0").state).toBe(
      "conflict",
    );
  });

  test("an absent file is absent", () => {
    expect(verdict(join(DIR, "gone.md"), ["comment"], "1.9.0").state).toBe(
      "absent",
    );
  });

  test("ok when every declared marker matches", () => {
    const path = fixture(
      "ok.md",
      `---\nversion: "1.9.0"\n---\n\n# Doc\n${COMMENT}\n`,
    );
    const v = verdict(path, ["frontmatter", "comment"], "1.9.0");
    expect(v.state).toBe("ok");
    expect(v.state === "ok" && v.version).toBe("1.9.0");
  });

  test("stale when the value is behind", () => {
    const path = fixture(
      "stale.md",
      "# Doc\n<!-- sepia-docs-version: 1.8.0 -->\n",
    );
    expect(verdict(path, ["comment"], "1.9.0").state).toBe("stale");
  });
});

describe("outcome — the severity policy", () => {
  // Verdicts built from TEXT, not hand-assembled literals, so these exercise
  // the same path the CLI does. This layer is the one every hole so far lived
  // in: a deleted marker that only warned, then warned again one phase over.
  const v = (text: string, declared: MarkerKind[], expected = "1.9.0") =>
    verdictOf({ exists: true, ...readText(text) }, declared, expected);
  const opts = (phase: "source" | "installed", owned?: boolean) => ({
    phase,
    expected: "1.9.0",
    owned,
  });

  test("source file: no marker at all is fatal", () => {
    expect(outcome(v("# Doc\n", ["comment"]), opts("source"))).toBe("fail");
  });

  test("installed copy: never installed is only a warning", () => {
    expect(outcome(v("# Doc\n", ["comment"]), opts("installed"))).toBe("warn");
  });

  test("installed copy WITH the install block that lost its marker is fatal", () => {
    // The block is in-band proof sepia was here, so "no marker" cannot mean
    // "not installed" — it means the marker was deleted.
    const text =
      "<!-- sepia:start -->\n## Sepia memory\nno version marker\n<!-- sepia:end -->\n";
    expect(outcome(v(text, ["comment"]), opts("installed"))).toBe("fail");
  });

  test("installed copy whose HTML comments were all stripped is still fatal", () => {
    // Round-3 shape: a formatter/rewrite removes every comment, so the block
    // MARKER is gone while sepia's whole block (and its heading) remains.
    const text =
      "# My notes\n\n## Sepia memory (always-on) — Claude Code\n\nYou are connected to the user's personal Sepia memory server.\n";
    expect(outcome(v(text, ["comment"]), opts("installed"))).toBe("fail");
  });

  test("installed copy of sepia's own file that lost its marker is fatal", () => {
    expect(outcome(v("# empty\n", ["comment"]), opts("installed", true))).toBe(
      "fail",
    );
  });

  test("installed copy: losing one of two declared markers is fatal", () => {
    const text = '---\nversion: "1.9.0"\n---\n\n# Doc\n';
    expect(
      outcome(v(text, ["frontmatter", "comment"]), opts("installed")),
    ).toBe("fail");
  });

  test("absent: fatal for a repo file, a warning for an installed copy", () => {
    const absent: Verdict = { state: "absent" };
    expect(outcome(absent, opts("source"))).toBe("fail");
    expect(outcome(absent, opts("installed"))).toBe("warn");
  });

  test("markers disagreeing is fatal in both phases", () => {
    const text = `---\nversion: "1.0.0"\n---\n\n# Doc\n${COMMENT}\n`;
    const declared: MarkerKind[] = ["frontmatter", "comment"];
    expect(outcome(v(text, declared), opts("source"))).toBe("fail");
    expect(outcome(v(text, declared), opts("installed"))).toBe("fail");
  });

  test("behind the server is stale; ahead of it is only a pending deploy", () => {
    const behind = "# Doc\n<!-- sepia-docs-version: 1.8.0 -->\n";
    const aheadText = "# Doc\n<!-- sepia-docs-version: 1.10.0 -->\n";
    expect(outcome(v(behind, ["comment"]), opts("installed"))).toBe("fail");
    expect(outcome(v(aheadText, ["comment"]), opts("installed"))).toBe("warn");
    // For a repo file "ahead" is not a deploy — it means DOCS_VERSION was
    // lowered below a stamped file, which is always wrong.
    expect(outcome(v(aheadText, ["comment"]), opts("source"))).toBe("fail");
  });

  test("current everywhere is ok", () => {
    const text = `---\nversion: "1.9.0"\n---\n\n# Doc\n${COMMENT}\n`;
    expect(outcome(v(text, ["frontmatter", "comment"]), opts("source"))).toBe(
      "ok",
    );
  });
});

describe("pattern invariants", () => {
  // Every form the CHECKER recognises, with the WRITE pattern that must be able
  // to overwrite it. If WRITE stops matching a form READ sees, the stamp cannot
  // repair that marker — it inserts a second one instead and leaves a
  // disagreement the checker reports and the stamp can never clear.
  const FORMS: { kind: "comment" | "line"; text: string }[] = [
    { kind: "comment", text: `# D\n<!-- sepia-docs-version: 1.9.0 -->\n` },
    { kind: "comment", text: `# D\n<!--sepia-docs-version:1.9.0-->\n` },
    { kind: "comment", text: `# D\n<!--   sepia-docs-version:  1.9.0   -->\n` },
    { kind: "line", text: "# D\n\nDocs version: 1.9.0\n" },
    { kind: "line", text: "# D\n\nDocs version:1.9.0\n" },
  ];

  test("everything the checker reads, the stamp can rewrite", () => {
    FORMS.forEach(({ kind, text }, i) => {
      const path = fixture(`form-${i}.md`, text);
      expect(readMarkers(path).markers.length).toBeGreaterThan(0);
      expect(text.match(WRITE_PATTERNS[kind])).not.toBeNull();
    });
  });

  test("write patterns are global — every marker line, not just the first", () => {
    const text = [
      "# D",
      COMMENT,
      "<!-- sepia-docs-version: 1.8.0 -->",
      "",
      "Docs version: 1.0.0",
      "Docs version: 1.1.0",
    ].join("\n");
    expect(text.match(WRITE_PATTERNS.comment)?.length).toBe(2);
    expect(text.match(WRITE_PATTERNS.line)?.length).toBe(2);
  });

  test("a marker quoted in prose is never rewritten", () => {
    const text = `# Doc\n\nThe form is \`${COMMENT}\` — never hand-edit it.\n`;
    expect(text.replace(WRITE_PATTERNS.comment, "CLOBBERED")).toBe(text);
  });

  test("frontmatterBlock is null without frontmatter", () => {
    expect(frontmatterBlock("# no frontmatter\n")).toBeNull();
  });
});

describe("manifest shape", () => {
  test("paths are unique and repo-relative", () => {
    const paths = AGENT_DOCS.map((d) => d.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const path of paths) expect(path.startsWith("/")).toBe(false);
  });

  test("every doc declares at least one marker", () => {
    for (const doc of AGENT_DOCS) expect(doc.markers.length).toBeGreaterThan(0);
  });
});

describe("compareVersions", () => {
  test("compares numerically, not as strings", () => {
    expect(compareVersions("1.10.0", "1.9.0")).toBe(1);
    expect(compareVersions("1.9.0", "1.10.0")).toBe(-1);
    expect(compareVersions("1.9.0", "1.9.0")).toBe(0);
    expect(compareVersions("1.9", "1.9.0")).toBe(0);
  });
});
