/**
 * Await a remote query proxy with a FORCED refetch.
 *
 * SvelteKit's `query()` memoizes by (function, serialized args): re-awaiting the
 * same call resolves the pre-mutation result forever, so a `load()` called after
 * a write would never show your own changes — the list only catches up on a full
 * page reload. Pages that hold a proxy long-term call `proxy.refresh()`
 * (details, settings, telemetry); this is the same thing for imperative
 * fire-and-forget `load()` functions.
 */
export async function fresh<T>(
	proxy: PromiseLike<T> & { refresh: () => Promise<void> }
): Promise<T> {
	await proxy.refresh();
	return proxy;
}
