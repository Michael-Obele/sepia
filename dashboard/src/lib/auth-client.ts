import { createAuthClient } from 'better-auth/svelte';
import { apiKeyClient } from '@better-auth/api-key/client';
import { dev } from '$app/environment';

/**
 * Better Auth client for the dashboard. Talks to the Fly server's
 * /api/auth/* endpoints. The session token (from sign-in) is used as a
 * bearer token by the remote functions — the bearer plugin makes that work.
 *
 * Defaults to the deployed server (it has CORS for localhost:5173). For
 * local-server dev, set VITE_AUTH_URL=http://localhost:8080 explicitly.
 */
export const authClient = createAuthClient({
	baseURL: import.meta.env.VITE_AUTH_URL,
	plugins: [apiKeyClient()]
});
