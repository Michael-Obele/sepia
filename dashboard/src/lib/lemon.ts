/**
 * Lemon.js loader + checkout opener (browser side).
 *
 * WHY A DEDICATED MODULE: Lemon.js is a small LS-owned script that must NOT be
 * loaded globally — the pricing page and the account page are the only places
 * that need it, and LS says never to self-host (you'd miss security patches).
 * So it's injected on first use and reused after.
 *
 * The overlay contract: `LemonSqueezy.Url.Open(url)` shows LS's checkout in
 * an iframe over our page. When it finishes, LS's iframe `postMessage`s the
 * window; we await that so the caller can refresh plan state and the user
 * never leaves the page. On `Checkout.Success` we then call
 * `LemonSqueezy.Url.Close()` (a documented method — docs.lemonsqueezy.com/
 * help/lemonjs/methods) so LS's post-payment "Welcome" card doesn't strand
 * the customer staring at a button for a dashboard they are already on.
 *
 * ⚠️ THERE ARE NO `lemonsqueezy:*` EVENTS. Earlier revisions of this file
 * listened for a `lemonsqueezy:success` / `lemonsqueezy:close` CustomEvent.
 * Neither exists: the real lemon.js (3861 bytes) contains zero occurrences of
 * `CustomEvent` and zero of `lemonsqueezy:`. The earlier code therefore never
 * received its completion event, and because the callers disable their button
 * until the promise settles, the button stayed stuck on "Starting…" forever —
 * a permanent lock, which is worse than the silent no-op it replaced.
 *
 * What lemon.js actually does (minified source):
 *
 *     function w(e){ r && r(e) }                       // forward to handler
 *     function b(){ d(), window.addEventListener("message", function (e) {
 *         if (w(e.data), …) … ; e.data === "mounted" && p();
 *         e.data === "close" && f() }) }               // DumbSetup
 *
 * So the overlay's whole lifecycle is plain `postMessage`, and the payloads are
 * heterogeneous: checkout completion arrives as an **object** carrying
 * `event: "Checkout.Success"`, while dismissal arrives as the bare **string**
 * `"close"`. `Setup({ eventHandler })` is just sugar that stores a handler for
 * `w()` to call — we listen directly instead, because `Setup` *replaces* the
 * single shared handler slot and lemon.js uses it internally for gtag events.
 * Listening ourselves avoids clobbering that, and lets us filter on origin.
 *
 * ⚠️ SECOND: LEMON.JS ONLY DEFINES ITS GLOBAL ON THE `window` `load` EVENT.
 * The last lines of the real script read:
 *
 *     n.createLemonSqueezy = function () { … n.LemonSqueezy = new y … };
 *     n.addEventListener ? n.addEventListener("load", n.createLemonSqueezy)
 *                        : n.attachEvent("onload", …);
 *
 * It never calls the factory itself — it only *subscribes* to `load`. Our
 * script is injected from a button click, long after `load` has already
 * fired, so that subscription never runs and `window.LemonSqueezy` stays
 * `undefined` forever. `script.onload` DOES fire (the script executed fine),
 * so naive "wait for onload" code looks like it worked and then blows up on
 * `LemonSqueezy.Url.Open`.
 *
 * `ensureGlobal()` below calls the factory explicitly — that is the fix. The
 * loader also still waits for `load` in the one case it can matter (the
 * script arriving before `load`, e.g. a future <head> injection).
 *
 * https://docs.lemonsqueezy.com/help/lemonjs/what-is-lemonjs
 * https://docs.lemonsqueezy.com/help/lemonjs/handling-events
 */

const LEMON_JS_SRC = 'https://app.lemonsqueezy.com/js/lemon.js';

/**
 * How long to wait for lemon.js before giving up and using the hosted
 * checkout. Generous enough for a slow connection, short enough that a stuck
 * tag doesn't strand the customer on a dead button.
 */
const SCRIPT_TIMEOUT_MS = 8000;

/**
 * Watchdog for the open overlay.
 *
 * The overlay is a modal: it ends with a `Checkout.Success` object or a
 * `"close"` string, both of which we listen for. This exists so that promise
 * can NEVER hang — if LS's iframe dies, is killed by a navigation, or simply
 * stops messaging, the caller's button would otherwise stay disabled for the
 * life of the page. Set well beyond a real card entry so it never fires
 * during a legitimate purchase; it is a backstop, not a timeout.
 */
const OVERLAY_WATCHDOG_MS = 15 * 60 * 1000;

/**
 * Hosts allowed to serve the checkout AND to postMessage at us. LS serves the
 * script from `app.lemonsqueezy.com` (302 → `assets.lemonsqueezy.com`) and
 * hosted checkouts from `<store>.lemonsqueezy.com`.
 */
const ALLOWED_CHECKOUT_HOSTS = ['lemonsqueezy.com'];

/** True for an https origin under an allow-listed LS host. */
function isLemonOrigin(origin: string): boolean {
	try {
		const parsed = new URL(origin);
		if (parsed.protocol !== 'https:') return false;
		return ALLOWED_CHECKOUT_HOSTS.some(
			(host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`)
		);
	} catch {
		return false;
	}
}

declare global {
	interface Window {
		LemonSqueezy?: {
			Url: {
				Open: (url: string) => void;
				/** Documented: closes the currently open overlay (lemon.js methods). */
				Close?: () => void;
			};
			/** LS's own refresh hook. */
			Refresh?: () => void;
		};
		/** Set by lemon.js. Must be CALLED to create the global. */
		createLemonSqueezy?: () => void;
		/** LS alias for the same factory. */
		createLemonSqueezyCheckout?: () => void;
	}
}

/**
 * What happened to a checkout attempt.
 *
 * A discriminated union rather than `{ completed: boolean }` because the old
 * shape could not distinguish "the customer closed the overlay" (normal — say
 * nothing) from "the overlay never opened" (a bug — the user must be told, or
 * redirected). Collapsing both into `completed: false` is exactly what made
 * this failure a silent no-op: the button spun and nothing happened, forever.
 */
export type CheckoutOutcome =
	/** Payment completed inside the overlay. */
	| { status: 'completed' }
	/** Customer dismissed the overlay without paying. Normal — stay quiet. */
	| { status: 'dismissed' }
	/** Overlay unavailable; we sent them to LS's hosted checkout in this tab. */
	| { status: 'redirected' }
	/** Checkout could not be started at all. */
	| { status: 'failed'; reason: string };

/** True once the global is really there (not merely "the script ran"). */
function hasLemon(): boolean {
	return typeof window.LemonSqueezy?.Url?.Open === 'function';
}

/**
 * Force the global into existence.
 *
 * Calls LS's own factory. Safe to call repeatedly — the factory is written to
 * be idempotent (`n.LemonSqueezy ? n.LemonSqueezy.Refresh() : …`).
 */
function ensureGlobal(): boolean {
	if (hasLemon()) return true;
	const factory = window.createLemonSqueezy ?? window.createLemonSqueezyCheckout;
	if (typeof factory !== 'function') return false;
	try {
		factory.call(window);
	} catch {
		return false;
	}
	return hasLemon();
}

let loadPromise: Promise<boolean> | null = null;

/**
 * Inject <script src="lemon.js"> once and make sure the global exists.
 *
 * Resolves `true` when the overlay is usable and `false` when it is not — the
 * caller then falls back to a hosted redirect rather than silently doing
 * nothing.
 *
 * Never hangs. Three ways out, in order: the script fires `load`/`error`, the
 * global turns out to already be creatable, or the attempt times out. Without
 * the timeout, a tag that is in the DOM but blocked (CSP, an extension) would
 * settle nothing, and because `loadPromise` is module-level that one dead tag
 * would poison every later attempt for the whole page session — the button
 * would do nothing, forever, which is the exact bug this module was rewritten
 * to eliminate.
 */
function loadLemonJs(): Promise<boolean> {
	if (hasLemon()) return Promise.resolve(true);
	if (loadPromise) return loadPromise;

	loadPromise = new Promise<boolean>((resolve) => {
		let settled = false;
		const done = (ok: boolean) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			// A failed attempt must not be cached, or every later click
			// replays the same failure forever.
			if (!ok) loadPromise = null;
			resolve(ok);
		};
		// Backstop for a tag that neither loads nor errors.
		const timer = setTimeout(() => done(false), SCRIPT_TIMEOUT_MS);

		// A tag may already be present: still in flight, or dead. Reuse it if
		// it can still produce the global, otherwise clear it and inject fresh.
		const existing = document.querySelector<HTMLScriptElement>(`script[src="${LEMON_JS_SRC}"]`);
		if (existing) {
			existing.addEventListener('load', () => done(ensureGlobal()), { once: true });
			// It may also have already executed without creating the global.
			if (ensureGlobal()) return done(true);
			existing.remove();
		}

		const script = document.createElement('script');
		script.src = LEMON_JS_SRC;
		script.defer = true;
		script.onload = () => {
			// The load event has already fired in every realistic case, so
			// DO NOT trust onload alone — drive the factory.
			done(ensureGlobal());
		};
		script.onerror = () => done(false);
		// If appendChild itself throws, the executor would reject and — because
		// `done` never ran — a REJECTED promise would be cached at module scope,
		// re-throwing on every later click. Resolve false instead.
		try {
			document.head.appendChild(script);
		} catch {
			// Deferred: a synchronous done(false) here would run BEFORE
			// `loadPromise = new Promise(...)` finishes assigning, and the
			// assignment would then cache the settled false — every later
			// click failing without a retry, the exact failure the reset in
			// done() exists to prevent (forge: LOW). A microtask runs after
			// the assignment, so done()'s `loadPromise = null` lands correctly.
			queueMicrotask(() => done(false));
		}
	});

	// If lemon.js is still in flight when `load` fires (script injected during
	// initial page load), this is where its own subscription would have run.
	if (typeof window.addEventListener === 'function' && document.readyState !== 'complete') {
		window.addEventListener('load', () => ensureGlobal(), { once: true });
	}

	return loadPromise;
}

/**
 * Lemon Squeezy owns the checkout. The URL arrives from the LS API over TLS via
 * `createCheckout`, but both branches below act on it — one puts it in a
 * full-viewport `allow="payment"` iframe, the other navigates the tab — and
 * neither lemon.js nor the browser checks where it points. Assert the origin
 * once, here, so a misconfigured or compromised response cannot turn the
 * checkout button into a redirect primitive.
 */
function isLemonCheckoutUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== 'https:') return false;
		return ALLOWED_CHECKOUT_HOSTS.some(
			(host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`)
		);
	} catch {
		return false;
	}
}

/**
 * Open a checkout URL in the overlay.
 *
 * Prefers the in-page overlay so the customer never leaves Sepia. If the
 * overlay cannot be used for any reason (script blocked by an extension, CSP,
 * offline), it falls back to LS's hosted checkout in the same tab — the same
 * destination `redirect_url` already points at, so the flow always completes.
 */
export async function openCheckout(url: string): Promise<CheckoutOutcome> {
	// Fail closed before anything acts on the URL.
	if (!isLemonCheckoutUrl(url)) {
		return {
			status: 'failed',
			reason: 'Checkout is temporarily unavailable — please try again.'
		};
	}

	const ready = await loadLemonJs();

	if (!ready) {
		// Last resort: the hosted checkout. Never leave the user with a dead
		// button — a payment flow that silently does nothing is worse than a
		// full-page navigation. (The toast the caller shows for this branch is
		// not worth relying on: navigation has already started by the time we
		// resolve, so it will rarely be seen.)
		window.location.href = url;
		return { status: 'redirected' };
	}

	return new Promise<CheckoutOutcome>((resolve) => {
		let settled = false;
		const finish = (outcome: CheckoutOutcome) => {
			if (settled) return;
			settled = true;
			clearTimeout(watchdog);
			// Listener cleanup: the overlay is a long-lived global target, so
			// leaving this attached would leak a closure per abandoned checkout.
			window.removeEventListener('message', onMessage);
			resolve(outcome);
		};

		/**
		 * LS's overlay reports its whole lifecycle by `postMessage`, with two
		 * different payload shapes (see the header note):
		 *   - completion: an OBJECT with `event: "Checkout.Success"`
		 *   - dismissal:  the bare STRING "close"
		 *
		 * Filtered on `event.origin` so nothing outside Lemon Squeezy can end
		 * a checkout — `postMessage` is reachable by any frame on the page.
		 */
		const onMessage = (event: MessageEvent) => {
			if (!isLemonOrigin(event.origin)) return;
			const data = event.data;
			if (data === 'close') return finish({ status: 'dismissed' });
			if (
				data &&
				typeof data === 'object' &&
				(data as { event?: string }).event === 'Checkout.Success'
			) {
				// Settle FIRST: `finish` removes the message listener, so a
				// Close() that happens to echo a 'close' message cannot turn a
				// completed payment into a dismissal.
				finish({ status: 'completed' });
				// U1: LS leaves its "Welcome to Sepia Pro" card up after paying
				// — with an "Open Dashboard" button for a dashboard the customer
				// is already on. Close it ourselves; best-effort, because the
				// overlay's own ✕ still works if this ever changes upstream.
				try {
					window.LemonSqueezy?.Url?.Close?.();
				} catch {
					// Non-fatal: the success toast below still communicates.
				}
				return;
			}
		};

		// Backstop so this promise can never hang. Callers disable their button
		// until it settles, so a silent hang is a permanent lock — the exact
		// bug the `CheckoutOutcome` union was introduced to prevent.
		const watchdog = setTimeout(() => finish({ status: 'dismissed' }), OVERLAY_WATCHDOG_MS);

		window.addEventListener('message', onMessage);

		try {
			window.LemonSqueezy!.Url.Open(url);
		} catch (err) {
			// Resolve — do NOT finish() and then throw. Settling the promise
			// first makes the throw a no-op that the executor silently
			// swallows, which is how this failure became invisible.
			finish({
				status: 'failed',
				reason: err instanceof Error ? err.message : 'Could not open checkout.'
			});
		}
	});
}
