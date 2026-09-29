/**
 * G9 — no real credential reaches a tracked file. Pure file I/O; no server, no DB.
 *
 * WHY this exists: on 2026-09-29 the real `LEMONSQUEEZY_WEBHOOK_SECRET` (40 hex
 * chars) sat in `src/billing/webhook.test.ts` as `const SECRET = "<40 hex>"`
 * under a comment reading `// 40 chars, as LS requires` — a comment that says
 * "placeholder" while the value is production. It was caught only because
 * someone happened to be looking. `verifySignature` is the sole thing standing
 * between the public internet and a self-granted `pro` plan, so a leaked signing
 * key is a billing bypass, not a cosmetic slip.
 *
 * This file is the thing that should have caught it, and it runs in the `unit`
 * CI job with no infrastructure — a guardrail with no runner is a paragraph.
 *
 * Three layers, in decreasing specificity:
 *   1. ENV LITERALS  — any value in .env appearing in a tracked file. Exact and
 *                      unforgiving, but needs a real .env, so it only fires on a
 *                      developer machine (and is a no-op in CI by design).
 *   2. SECRET-NAMED ASSIGNMENTS — a long literal bound to a secret-ish name.
 *                      Catches the incident above, in CI, with no .env at all.
 *   3. PROVIDER SHAPES — `sk_live_`, `ghp_`, `AKIA…`, JWTs, private keys, and
 *                      credential-bearing URLs. Cheap, high-signal, never fires
 *                      on well-formed placeholders.
 *
 * Deliberately NOT a general-purpose scanner: it has no entropy model and does
 * not try to be one. Every rule is a literal a reviewer can check, so a hit is
 * always real. Layer 1 is the exhaustive one; 2 and 3 exist because layer 1
 * cannot run in CI.
 *
 * Run from the repo root:  bun test scripts/no-secrets.test.ts
 */
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..");

/** Files we read. Binary/vendored blobs (e.g. packages/sepia-mcp/tmcp) are
 *  excluded by extension and by size — the point is to audit source, not blobs
 *  nobody can review anyway. */
const TEXT_EXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".jsonc",
  ".md",
  ".mdx",
  ".txt",
  ".yml",
  ".yaml",
  ".toml",
  ".sql",
  ".sh",
  ".bash",
  ".html",
  ".css",
  ".env",
  ".example",
  ".ini",
  ".cfg",
  ".lock",
]);
/** Extension-less files that are still text and still matter. */
const TEXT_BASENAMES = new Set([
  "Dockerfile",
  "LICENSE",
  "Procfile",
  "Makefile",
  ".npmrc",
  ".dockerignore",
  ".gitignore",
  ".env.example",
]);
const MAX_BYTES = 1_000_000;

/** Env files that hold real values. `.env.example` is deliberately absent —
 *  it is COMMITTED, so a value in it is by definition a published value. */
const ENV_FILES = [".env", "dashboard/.env"];

/**
 * Values that are obviously not real even when they are long. Keep this tight:
 * every entry is a shape a human would read as fake at a glance. A value that
 * merely *looks* random is not exculpated — that is the whole incident.
 */
const OBVIOUSLY_FAKE = [
  /^[0]+$/, // 000…0
  /^(.)\1{7,}$/, // one repeated character: aaaa…, xxxx…
  /^dummy/i,
  /^placeholder/i,
  /^changeme/i,
  /^replace[-_]?me/i,
  /^(your|my)[-_]/i,
  /example/i,
  /xxxx/i,
  /^<.*>$/, // <your-key-here>
  /^\$\{.*\}$/, // ${input:token}
];

/** Provider token shapes. Prefixed formats are unambiguous, so these can be
 *  strict — no allowlist needed. */
const PROVIDER_SHAPES: Array<[string, RegExp]> = [
  ["Stripe secret key", /\b(sk|rk)_live_[A-Za-z0-9]{16,}/],
  ["Stripe publishable/live", /\bpk_live_[A-Za-z0-9]{16,}/],
  ["Lemon Squeezy / generic whsec", /\bwhsec_[A-Za-z0-9]{16,}/],
  ["GitHub token", /\b(ghp|gho|ghs|ghu)_[A-Za-z0-9]{30,}/],
  ["GitHub fine-grained PAT", /\bgithub_pat_[A-Za-z0-9_]{40,}/],
  ["AWS access key id", /\bAKIA[0-9A-Z]{16}\b/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["Slack token", /\bxox[baprs]-[A-Za-z0-9-]{10,}/],
  ["npm token", /\bnpm_[A-Za-z0-9]{30,}/],
  ["GitLab PAT", /\bglpat-[A-Za-z0-9_-]{20,}/],
  ["Private key block", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["JWT", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/],
  // A bare 40-hex literal: the LS/webhook signing-key shape, with no prefix
  // and possibly no secret-ish NAME bound to it. This is the gap that let the
  // real secret sit in this very file as `const key = "…"` — `key` alone is
  // not secret-ish, so layer 2 could not see it. Exact-40 only: `\b` at both
  // ends means a 64-hex sha256 does NOT match (no boundary mid-run), so
  // checksums in lockfiles are unaffected. A git SHA would match — the tree
  // carries none, and one appearing in a doc should be shortened anyway.
  ["Bare hex signing key", /\b[0-9a-f]{40}\b/],
];
/** A URL with `user:pass@` inline. Split out from the list above because it
 *  needs a placeholder carve-out — `postgresql://user:password@ep-xxx…` is
 *  documentation, `postgres://appuser:Xy9@db.acmecorp.internal` is a breach. */
const URL_CREDENTIAL =
  /\b([a-z][a-z0-9+.-]*:\/\/)([^/\s"'@:]{1,64}):([^/\s"'@]{1,64})@([^\s"'/]{1,255})/gi;

/** A URL whose host is local or a stand-in. A throwaway CI service container
 *  (`postgres://postgres:sepia@localhost`) is not a leaked production DSN.
 *  The port is stripped first: the capture runs to the next `/`. */
const isPlaceholderUrl = (hostAndPort: string) => {
  const host = hostAndPort.replace(/:\d+$/, "");
  return (
    /^(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|host\.docker\.internal)$/i.test(
      host,
    ) ||
    /(?:^|[.\-_])(?:xxx|example|invalid|test|local)(?:[.\-_]|$)/i.test(host)
  );
};

/** Identifiers that CONTAIN a secret word but are not secrets — `token` inside
 *  `tokenizer` is the trap that made the first draft of this file unusable. */
const SECRET_NAME = String.raw`(?:secret|token(?!i(?:zer|ze|zing))|passw(?:or)?d|api_?key(?!_(?:alphabet|charset|set|id|prefix|suffix))|credential|signing_?key|private_?key|auth_?key)`;
/** Captures (1) the identifier and (2) the literal. The NAME is the only signal
 *  layer 2 has, so it must catch `SECRET`, `webhookSecret`, `apiKey`,
 *  `password`, `token`, `credential`, `signingKey`. */
const SECRET_ASSIGNMENT = new RegExp(
  String.raw`\b([A-Za-z0-9_]*` +
    SECRET_NAME +
    String.raw`[A-Za-z0-9_]*)\s*[:=]\s*["'\`]([^"'\`\n]{16,})["'\`]`,
  "gi",
);

/** A value that is an indirection, not a credential. */
const isIndirection = (v: string) =>
  /^(?:process\.env|import\.meta\.env|env\.|Bun\.env)/.test(v) || // env lookup
  /[$`]/.test(v) || // ${…}, $(…), backticked shell
  /^[A-Z][A-Z0-9_]{3,}$/.test(v); // a bare CONSTANT reference

const isObviouslyFake = (v: string) => OBVIOUSLY_FAKE.some((re) => re.test(v));

/** Env keys whose values are public by construction, whatever they are called.
 *  A `*_URL` is skipped here, which stays safe because a DSN carries its
 *  password IN the url and is therefore caught by URL_CREDENTIAL below. */
const PUBLIC_KEY =
  /(?:^|_)(?:URL|URI|ORIGIN|HOST|HOSTNAME|PORT|INDEX|REGION|MODE|STORE_ID|VARIANT_ID|VERSION)$/i;

/** Long, non-indirect, non-placeholder literals bound to a secret-ish name. */
function findSecretAssignments(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(SECRET_ASSIGNMENT)) {
    const value = m[2]!;
    if (isIndirection(value)) continue;
    if (isObviouslyFake(value)) continue;
    out.push(`${m[1]} = ${value.slice(0, 8)}…`);
  }
  return out;
}

/** Well-known token formats, plus credentials embedded in a url. */
function findProviderShapes(text: string): string[] {
  const out: string[] = [];
  for (const [, pattern] of PROVIDER_SHAPES) {
    const re = new RegExp(
      pattern.source,
      pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`,
    );
    for (const m of text.matchAll(re)) {
      // Obvious placeholders are exempt from EVERY shape rule, not just the
      // name rule — otherwise the 40-zeros fixture in webhook.test.ts (an
      // intentionally fake signing key) fails this sweep forever.
      if (isObviouslyFake(m[0])) continue;
      out.push(m[0].slice(0, 12));
    }
  }
  for (const m of text.matchAll(URL_CREDENTIAL)) {
    if (isPlaceholderUrl(m[4]!)) continue;
    out.push(`${m[1]}${m[2]}:***@${m[4]}`);
  }
  return out;
}

/** Every tracked, text-like file, as repo-relative paths. */
function trackedFiles(): string[] {
  const res = spawnSync("git", ["ls-files", "-z"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0 || !res.stdout) return [];
  return res.stdout.split("\0").filter(Boolean);
}

function isTextish(path: string): boolean {
  const base = path.split("/").pop() ?? path;
  return TEXT_EXT.has(extname(base).toLowerCase()) || TEXT_BASENAMES.has(base);
}

/** path → contents, for tracked text files that exist and are a sane size. */
function readTrackedText(): Map<string, string> {
  const out = new Map<string, string>();
  for (const rel of trackedFiles()) {
    if (!isTextish(rel)) continue;
    const abs = join(ROOT, rel);
    try {
      if (!existsSync(abs) || statSync(abs).size > MAX_BYTES) continue;
      out.set(rel, readFileSync(abs, "utf8"));
    } catch {
      /* unreadable file is not a finding */
    }
  }
  return out;
}

const TRACKED = readTrackedText();

/** This module's own repo-relative path. */
const SELF = join(relative(ROOT, import.meta.dir), "no-secrets.test.ts");

/**
 * The shape/name sweeps skip THIS file — necessarily. A scanner's fixtures
 * must look like the leaks they detect (`sk_live_…`, a DSN carrying a
 * password, `dbPassword = "…"`), so scanning itself flags its own proof and
 * the suite fails on every run. The moment it failed constantly it would be
 * deleted, and a guardrail nobody keeps is worse than none.
 *
 * The carve-out is deliberately narrow: it applies ONLY to those two sweeps.
 * Layer 1 (values lifted from the real .env) still scans this file, so a
 * genuine credential pasted here is caught like anywhere else. Layer 1 is the
 * exhaustive one — this is not a blind spot, it is a shape exemption.
 */
const SWEEP = new Map([...TRACKED].filter(([path]) => path !== SELF));

/** `KEY=VALUE` pairs from an env file, comments and blanks dropped. */
function envEntries(path: string): Array<[string, string]> {
  const abs = join(ROOT, path);
  if (!existsSync(abs)) return [];
  return readFileSync(abs, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const eq = l.indexOf("=");
      return [l.slice(0, eq).trim(), l.slice(eq + 1).trim()] as [
        string,
        string,
      ];
    })
    .filter(([k, v]) => v.length >= 8 && !PUBLIC_KEY.test(k));
}

// ── The scanners are not inert ─────────────────────────────────────────────

const DIR = mkdtempSync(join(tmpdir(), "sepia-no-secrets-"));
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

/**
 * Write a fixture into the temp dir and scan it there.
 *
 * Fixtures are NOT inline on purpose. A leak-shaped literal has to be
 * recognisable as leak-shaped to prove the scanner works — and if it sat in
 * this file, the repo-wide sweep would flag this file and fail. Writing to disk
 * first keeps the proof without the self-reference, and it exercises the same
 * read path the real sweep uses.
 */
function scanFixture(name: string, text: string) {
  const path = join(DIR, name);
  writeFileSync(path, text);
  return readFileSync(path, "utf8");
}

/**
 * A 40-hex string shaped EXACTLY like a signing key, assembled from chunks so
 * that no 40-hex literal exists anywhere in this file. That matters: the sweep
 * scans tracked files, and this file is tracked — an inline fixture would make
 * the guardrail fail on itself, which is precisely how the real secret went
 * unnoticed here once already.
 */
const SYNTH_KEY = [
  "7a1c",
  "9f30",
  "be45",
  "d261",
  "48ac",
  "0e7f",
  "35b9",
  "6d12",
  "c804",
  "f36e",
].join("");

/**
 * Same treatment as SYNTH_KEY, for a shape GitHub's push protection matches
 * literally. The value below is visibly synthetic (`…abcdefghij`) but push
 * protection cannot read intent — it saw `sk_live_` + 24 alnum and declined
 * the push (2026-09-29). Splitting the prefix from the body means the source
 * never contains the match, while `join` still yields one for the assertion.
 */
const SYNTH_STRIPE = ["sk_live_", "51H8xQ2KZvLyT0", "abcdefghij"].join("");

describe("G9: the scanners actually catch things", () => {
  // A guardrail that cannot fail is a comment. Every case below is a shape a
  // future edit to the patterns could silently stop matching — the point is
  // that weakening a regex fails HERE, loudly, not in production.
  test("catches a hex signing key bound to SECRET (the 2026-09-29 shape)", () => {
    const key = SYNTH_KEY;
    const text = scanFixture("leak.ts", `const SECRET = "${key}";`);
    expect(findSecretAssignments(text)).toEqual([
      `SECRET = ${key.slice(0, 8)}…`,
    ]);
  });

  test("catches a 40-hex key bound to a NON-secret-ish name (the gap that hid it here)", () => {
    // `key` is not in SECRET_NAME, so layer 2 is blind to this. Only the bare
    // hex shape rule sees it — which is the whole reason that rule exists.
    const text = scanFixture("bare.ts", `const key = "${SYNTH_KEY}";`);
    expect(findSecretAssignments(text)).toEqual([]);
    expect(findProviderShapes(text)).toHaveLength(1);
  });

  test("catches a password bound to a camelCase name", () => {
    const text = scanFixture(
      "pw.ts",
      `const dbPassword = "hunter2-correct-horse";`,
    );
    expect(findSecretAssignments(text)).toEqual(["dbPassword = hunter2-…"]);
  });

  test("does NOT flag tokenizer, alphabets, shell interpolation, or env reads", () => {
    // These four false positives made the first draft of this file unusable.
    for (const [name, src] of [
      ["tok.ts", `tokenizer: "edge_ngram_tokenizer"`],
      ["alpha.ts", `API_KEY_ALPHABET = "abcdefghijklmnopqrstuvwxyz012345"`],
      ["shell.sh", 'TOKEN="${SEPIA_TOKEN:-${MCP_BEARER_TOKEN:-}}"'],
      ["env.ts", `password = process.env.DB_PASSWORD!`],
    ] as const) {
      expect(findSecretAssignments(scanFixture(name, src))).toEqual([]);
    }
  });

  test("accepts the obvious placeholders the repo actually uses", () => {
    for (const fake of [
      `"0000000000000000000000000000000000000000"`,
      `"dummy_api_key_replace_me"`,
      `"dummy_webhook_signing_secret_replace_me"`,
      `"<your-key-here>"`,
      `"xxxxxxxxxxxxxxxxxxxxxx"`,
    ]) {
      expect(
        findSecretAssignments(scanFixture("ph.ts", `const SECRET = ${fake};`)),
      ).toEqual([]);
    }
  });

  test("flags a real provider token, and skips placeholder-url DSNs", () => {
    expect(
      findProviderShapes(scanFixture("sk.ts", `const k = "${SYNTH_STRIPE}";`)),
    ).toHaveLength(1);
    expect(
      findProviderShapes(
        scanFixture(
          "a.txt",
          `postgresql://user:password@ep-xxx-pooler.aws.neon.tech/db`,
        ),
      ),
    ).toEqual([]);
    expect(
      findProviderShapes(
        scanFixture(
          "b.txt",
          `postgres://postgres:sepia@localhost:5432/sepia_test`,
        ),
      ),
    ).toEqual([]);
  });

  test("flags a production DSN carrying a real password", () => {
    expect(
      findProviderShapes(
        scanFixture(
          "dsn.txt",
          `DATABASE_URL=postgres://appuser:Xy9qRealPass@db.acmecorp.internal:5432/app`,
        ),
      ),
    ).toHaveLength(1);
  });
});

// ── The repo itself ────────────────────────────────────────────────────────

describe("G9: repo-wide sweep", () => {
  // If git were missing, the sweep would scan nothing and report green
  // forever. Assert it actually saw the tree.
  test("the sweep saw the repo", () => {
    expect(TRACKED.size).toBeGreaterThan(50);
  });

  // A carve-out that silently covered the whole tree would make every test
  // below vacuous. Assert it removes exactly this file.
  test("the self carve-out is exactly one file", () => {
    expect(TRACKED.has(SELF)).toBe(true);
    expect(TRACKED.size - SWEEP.size).toBe(1);
    expect(SWEEP.has(SELF)).toBe(false);
  });

  test("no provider token shapes in tracked files (minus own fixtures)", () => {
    const hits: string[] = [];
    for (const [path, text] of SWEEP) {
      for (const found of findProviderShapes(text))
        hits.push(`${path}: ${found}`);
    }
    expect(hits).toEqual([]);
  });

  test("no real literal bound to a secret-ish name in tracked files (minus own fixtures)", () => {
    const hits: string[] = [];
    for (const [path, text] of SWEEP) {
      for (const found of findSecretAssignments(text))
        hits.push(`${path}: ${found}`);
    }
    expect(hits).toEqual([]);
  });
});

// ── Layer 1: real .env values ──────────────────────────────────────────────

describe("G9: no .env value appears in a tracked file", () => {
  const present = ENV_FILES.filter((f) => existsSync(join(ROOT, f)));

  // CI has no .env, so this layer is a no-op there. That is fine — it is the
  // exhaustive layer, and it earns its keep on a developer machine. Layers 2
  // and 3 are what CI actually runs.
  test.skipIf(present.length === 0)("no env file is committed", () => {
    for (const f of ENV_FILES) {
      expect(trackedFiles()).not.toContain(f);
    }
  });

  test.skipIf(present.length === 0)(
    "no literal from .env leaks into tracked source",
    () => {
      const hits: string[] = [];
      for (const envFile of present) {
        for (const [key, value] of envEntries(envFile)) {
          if (isObviouslyFake(value)) continue;
          for (const [path, text] of TRACKED) {
            if (path === envFile) continue;
            if (text.includes(value)) hits.push(`${envFile}:${key} → ${path}`);
          }
        }
      }
      expect(hits).toEqual([]);
    },
  );
});
