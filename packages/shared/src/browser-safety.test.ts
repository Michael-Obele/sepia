import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * This package has two doors.
 *
 *   `@sepia/shared`       (index.ts)  — everything, including Postgres and the
 *                                       Drizzle schema. Server only.
 *   `@sepia/shared/types` (types.ts)  — imports nothing. Safe in a browser.
 *
 * Only the second may be imported by dashboard code. Getting that wrong is a
 * silent failure: it ships the database layer to the browser and then throws at
 * runtime, the first time a re-exported module touches a Node builtin. That is
 * exactly what happened — `db/lib/telemetry.ts` gained a top-level
 * `node:crypto` import, the Connect page had long been importing the barrel for
 * a constant, and the result was the whole app failing to start with Vite's
 * "module externalized for browser compatibility".
 *
 * Nothing was wrong with either change on its own. Only the combination broke,
 * and nothing warned. So the rule is asserted here instead of remembered.
 */

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const CLIENT_ROOT = join(REPO_ROOT, "dashboard", "src");

const BARREL_SPECIFIER = /from\s+["']@sepia\/shared["']/;
const DYNAMIC_BARREL = /import\(\s*["']@sepia\/shared["']\s*\)/;

/**
 * `import type { X } from "@sepia/shared"` is erased before the browser ever
 * sees it, so it is harmless. Remove those, then look for anything left.
 */
const TYPE_ONLY_IMPORT =
	/import\s+type\s*(?:\{[^}]*\}|\*\s+as\s+[\w$]+|[\w$]+)\s*from\s*["']@sepia\/shared["'];?/gs;

/** Files whose contents never reach the browser bundle. */
function isServerOnly(relativePath: string): boolean {
	return (
		relativePath.endsWith(".remote.ts") ||
		relativePath.endsWith("+server.ts") ||
		relativePath.endsWith(".server.ts") ||
		relativePath.includes("lib/server/")
	);
}

function walk(dir: string, found: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			if (entry === "node_modules" || entry.startsWith(".")) continue;
			walk(full, found);
		} else if (entry.endsWith(".ts") || entry.endsWith(".svelte")) {
			found.push(full);
		}
	}
	return found;
}

function stripComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("the shared package's browser boundary", () => {
	test("types.ts imports nothing, so it stays safe to bundle", () => {
		const source = stripComments(
			readFileSync(join(import.meta.dir, "types.ts"), "utf8"),
		);
		expect(source).not.toMatch(/\bimport\b/);
		expect(source).not.toMatch(/\brequire\s*\(/);
	});

	test("no browser-reachable dashboard file imports the server barrel", () => {
		const offenders: string[] = [];

		for (const file of walk(CLIENT_ROOT)) {
			const relativePath = relative(CLIENT_ROOT, file).replaceAll("\\", "/");
			if (isServerOnly(relativePath)) continue;

			const source = readFileSync(file, "utf8");
			const withoutTypes = source.replace(TYPE_ONLY_IMPORT, "");

			if (BARREL_SPECIFIER.test(withoutTypes) || DYNAMIC_BARREL.test(withoutTypes)) {
				offenders.push(relativePath);
			}
		}

		expect(
			offenders,
			"These import `@sepia/shared`, which pulls Postgres into the browser " +
				"bundle. Import from `@sepia/shared/types` instead (add the constant " +
				"there if it is missing).",
		).toEqual([]);
	});
});
