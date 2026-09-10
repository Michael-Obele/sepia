import { dev } from '$app/environment';
import { getRequestEvent } from '$app/server';

/**
 * The dashboard's own session cookie. This is deliberately NOT Better Auth's
 * cookie: the auth server lives on a different origin (sepia.fly.dev), so a
 * cookie it issued would be third-party and would be blocked/partitioned by
 * browsers. Instead the sign-in remote function receives the Better Auth
 * session token server-to-server and writes it into a cookie on *this* origin,
 * which is first-party, HTTP-only, and survives new tabs.
 *
 * The `__Host-` prefix makes the BROWSER enforce the three rules that stop
 * subdomain cookie-injection ("cookie tossing"): Secure, an absolute `Path=/`,
 * and no `Domain` attribute. It can only be used over HTTPS, so dev — where we
 * serve plain HTTP on localhost — falls back to an unprefixed name.
 */
export const SESSION_COOKIE = dev ? 'sepia_session' : '__Host-sepia_session';

/**
 * Session lifetime, renewed on activity (see `renewSessionIfStale` in
 * `$lib/server/auth`). Because the expiry is what we slide, this doubles as
 * the idle timeout: a session untouched for this long is already expired.
 */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Absolute cap on a session's life, measured from its creation. Sliding the
 * expiry with no ceiling would let a stolen token live forever.
 */
export const SESSION_MAX_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Minimum staleness before we rewrite a session's expiry. Bounds sliding to at
 * most one write per session per interval, instead of one write per request.
 */
export const SESSION_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

const MAX_AGE_SECONDS = SESSION_TTL_MS / 1000;

export function sessionCookieOptions() {
	return {
		// Remote functions require an absolute path.
		path: '/',
		httpOnly: true,
		sameSite: 'lax' as const,
		secure: !dev,
		maxAge: MAX_AGE_SECONDS
	};
}

/** Read the session token. Works in any remote function and in load. */
export function readSessionToken(): string | null {
	return getRequestEvent().cookies.get(SESSION_COOKIE) ?? null;
}

/** Write the session token. Only valid in a `command` or `form` remote function. */
export function writeSessionToken(token: string): void {
	getRequestEvent().cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
}

/** Clear the session token. Only valid in a `command` or `form` remote function. */
export function clearSessionToken(): void {
	getRequestEvent().cookies.delete(SESSION_COOKIE, { path: '/' });
}
