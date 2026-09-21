/**
 * Identity of the running BUILD.
 *
 * WHY THIS EXISTS. The MCP spec requires `serverInfo.version`, so the server
 * needs *something* there — and that something used to be the literal `"1.0.0"`,
 * which no process owned and nothing bumped. Live proof it was a lie: /version
 * advertised 1.0.0 while the docs version was 1.9.0 and the npm package was
 * 0.8.4. A version nobody maintains is worse than no version, because it is
 * believed.
 *
 * The deployed server has no semver to report: it is redeployed from master
 * whenever the repo changes, so a hand-written number here would rot exactly the
 * same way, and a second hand-bumped counter beside DOCS_VERSION would just
 * reintroduce the freeze this repo already spent a day removing. Fly names every
 * deploy, and that name IS the version of what is running — so report it:
 * truthful by construction, nothing to remember.
 *
 * (The npm package `sepia-mcp` is a DIFFERENT artifact with a real semver —
 * Changesets maintains its package.json — and it reports that instead.)
 */
const DEV = "dev";

/**
 * The deploy's identity, read from Fly's machine environment.
 *
 * See https://fly.io/docs/machines/runtime-environment/
 */
export function deployVersion(
  env: Record<string, string | undefined> = process.env,
): string {
  const tag = env.FLY_IMAGE_REF?.split(":").pop();
  if (tag) return tag;
  if (env.FLY_MACHINE_VERSION) return `machine-${env.FLY_MACHINE_VERSION}`;
  return DEV;
}

export const SERVER_VERSION = deployVersion();
