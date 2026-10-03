// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
//
// `import type` (NOT an inline type reference): the type is erased either way,
// but only a top-level type-only import is recognised as safe by
// `browser-safety.test.ts`. An inline reference into the server barrel cannot be
// told apart from a runtime dynamic import of it — which would pull Postgres into
// the client bundle — so the guard flags that form, correctly. Keep the barrel's
// specifier out of this comment too: the guard reads comments.
import type { UserRow } from '@sepia/shared';

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			/**
			 * Memoised session user for THIS request — see `getSessionUser` in
			 * `$lib/server/auth`. `undefined` = not resolved yet; `null` = resolved
			 * and anonymous. Storing it here is what lets a remote query invoked
			 * during SSR reuse the user the root `+layout.server.ts` already looked
			 * up, instead of running the sessions⋈users join a second time.
			 */
			user?: UserRow | null;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
