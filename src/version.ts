/**
 * Identity of the running BUILD. The MCP spec requires `serverInfo.version`, and the literal
 * "1.0.0" that used to sit here was a lie nobody maintained — /version advertised 1.0.0 while
 * docs said 1.9.0. This server is redeployed from master, so it has no semver: Fly names every
 * deploy and that name IS the running version. (`sepia-mcp` is a separate artifact with a real
 * semver from Changesets, and reports its own.)
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
