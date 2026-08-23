# Connecting Sepia to Grok (Custom MCP Connector)

> **Status: OAuth 2.1 is Phase 2 and not yet deployed.**
> The live server (`https://sepia.fly.dev`) currently runs **Phase 1 — static Bearer token**.
> Grok's custom connectors require **OAuth 2.1**, so the connector flow below ends at an
> OAuth credential form that **cannot be completed with working credentials until Phase 2 ships**.
> See [the caveat](#caveat-why-the-oauth-form-cant-be-filled-yet).

Grok supports "bring your own MCP" connectors. Because Grok runs from its own cloud, it needs
the server to be publicly reachable (it is) and to authenticate via OAuth 2.1.

## What you'll see

### 1. Open New Connector

Go to `grok.com/connectors` → **New Connector** → **Custom**.

![New Connector](./images/grok/01-new-connector.png)

### 2. Name it and paste the MCP URL

Enter a name (e.g. `Sepia`) and the server URL `https://sepia.fly.dev/mcp`, then **Add Connector**.

![Custom Connector](./images/grok/02-custom-connector.png)

### 3. Grok detects auth and asks for OAuth credentials

Grok probes the server for OAuth metadata. When it can't find a standard authorization server,
it falls back to a manual **OAuth Credentials Required** form.

![OAuth Credentials Required](./images/grok/03-oauth-credentials.png)

## Caveat: why the OAuth form can't be filled yet

The form asks for:

- **Client ID** / **Client Secret**
- **Authorization Endpoint** / **Token Endpoint**
- **Scopes**, **Token Auth Method**

These come from an **OAuth app registration** — an authorization server Sepia doesn't expose yet.
You can verify the current state:

| Probe                                                              | Result                  | Meaning                                |
| ------------------------------------------------------------------ | ----------------------- | -------------------------------------- |
| `GET https://sepia.fly.dev/`                                       | `"auth":"bearer-token"` | Server is Phase 1 (static Bearer)      |
| `GET https://sepia.fly.dev/.well-known/oauth-authorization-server` | `404`                   | No OAuth authorization-server metadata |
| `GET https://sepia.fly.dev/.well-known/oauth-protected-resource`   | `404`                   | No OAuth protected-resource metadata   |

There are **no real Client ID / Client Secret / authorization / token endpoints** for Sepia to put
into that form, because **OAuth 2.1 (Phase 2, via `@tmcp/auth`) is on the roadmap (`M4`) but not yet
deployed**. Grok won't accept a bare Bearer token through this UI.

## What to do instead

### Option A — use a Bearer-token client today (works now)

Local editors and Claude-style connectors accept the static `Authorization: Bearer` header directly:

- **Claude Code**

  ```bash
  claude mcp add --transport http sepia https://sepia.fly.dev/mcp \
    --header "Authorization: Bearer YOUR_TOKEN"
  ```

- **Cursor / VS Code Copilot** (`.cursor/mcp.json` / `.vscode/mcp.json`)

  ```json
  {
    "mcpServers": {
      "sepia": {
        "type": "http",
        "url": "https://sepia.fly.dev/mcp",
        "headers": { "Authorization": "Bearer YOUR_TOKEN" }
      }
    }
  }
  ```

- **Zed** — Settings → Agent → MCP, same shape.

Get your token from the dashboard's **Connect an AI** page, or the `MCP_BEARER_TOKEN` Fly secret.

### Option B — enable OAuth to use Grok / ChatGPT / Gemini

Deploy **Phase 2**: add `@tmcp/auth` as the authorization server, expose
`/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource` (RFC 9728),
and set the Fly secret `OAUTH_JWK_SECRET`. Then Grok auto-detects OAuth and you sign in in the
browser instead of entering credentials manually. Tracked as roadmap items **M4 → M5**.
