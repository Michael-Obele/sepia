# sepia-mcp

A self-contained MCP server for [Sepia](https://sepia.fly.dev) — your personal
knowledge-graph memory server. It exposes the **same 7 tools** as the Sepia
server (`manage_namespace`, `manage_entity`, `manage_relation`, `manage_memory`,
`search`, `traverse_graph`, `prune_memories`), but every call is proxied to the
Sepia REST API. No database, no migrations — just a lightweight MCP wrapper.

## Install

```bash
npm install -g sepia-mcp   # or run directly with npx
```

## Usage

### stdio (default — for Claude, VS Code, etc.)

```bash
export SEPIA_URL=https://sepia.fly.dev
export SEPIA_API_KEY=your_token   # the server's MCP_BEARER_TOKEN or an API key
sepia-mcp
```

Or with `npx`:

```bash
npx sepia-mcp
```

MCP client config:

```json
{
  "mcpServers": {
    "sepia": {
      "command": "npx",
      "args": ["sepia-mcp"],
      "env": {
        "SEPIA_URL": "https://sepia.fly.dev",
        "SEPIA_API_KEY": "your_token"
      }
    }
  }
}
```

### http (self-host on Fly.io / any Node host)

```bash
export SEPIA_URL=https://sepia.fly.dev
export SEPIA_API_KEY=your_token
sepia-mcp --http        # serves Streamable HTTP at /mcp on PORT (default 8080)
```

## Environment variables

| Variable        | Default                 | Description                                 |
| --------------- | ----------------------- | ------------------------------------------- |
| `SEPIA_URL`     | `https://sepia.fly.dev` | Base URL of the Sepia server                |
| `SEPIA_API_KEY` | _(required)_            | Bearer token (server's `MCP_BEARER_TOKEN`)  |
| `SEPIA_SOURCE`  | `sepia-mcp`             | Client name recorded as the memory `source` |
| `PORT`          | `8080`                  | Port for `--http` mode                      |

## Tools

The tool surface matches the Sepia server exactly — same names, same schemas,
same `instructions` contract. All calls hit `SEPIA_URL/api/*` with
`Authorization: Bearer $SEPIA_API_KEY`.

## Development

```bash
bun install
bun run build   # bundles to dist/index.js
bun run check   # type-check
```

## Publishing

Versioning is handled by [Changesets](https://github.com/changesets/changesets)
and publishing by the `.github/workflows/release.yml` GitHub Action, which runs
on every push to `main` touching `packages/sepia-mcp/**`,
`packages/shared/src/**`, or `.changeset/**`. It auto-creates a patch changeset
if one is missing, so **every edit to the package ships a new npm version** —
keeping the MCP in lockstep with the app. Publishes use npm **provenance**
(OIDC) for supply-chain attestation.

## License

MIT
