import { createAuthClient } from 'better-auth/svelte';
import { apiKeyClient } from '@better-auth/api-key/client';
import { dev } from '$app/environment';

/**
 * Better Auth client for the dashboard. Talks to the Fly server's
 * /api/auth/* endpoints. The session token (from sign-in) is used as a
 * bearer token by the remote functions — the bearer plugin makes that work.
 *
 * In dev, point at the local server (VITE_AUTH_URL or localhost:8080).
 */
export const authClient = createAuthClient({
	baseURL:
		import.meta.env.VITE_AUTH_URL ?? (dev ? 'http://localhost:8080' : 'https://sepia.fly.dev'),
	plugins: [apiKeyClient()]
});
