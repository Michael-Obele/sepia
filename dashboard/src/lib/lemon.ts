/**
 * Lemon.js loader + checkout opener (browser side).
 *
 * WHY A DEDICATED MODULE: Lemon.js is 2.3 kB of LS-owned script that must NOT
 * be loaded globally — the pricing page and the account page are the only
 * places that need it, and LS says never to self-host (you'd miss security
 * patches). So it's injected on first use and reused after.
 *
 * The overlay contract: `LemonSqueezy.Url.Open(url)` shows LS's checkout in
 * an iframe over our page. On success LS fires a `lemonsqueezy:success`
 * CustomEvent — we await it so the caller can refresh plan state and the user
 * never leaves the page.
 *
 * https://docs.lemonsqueezy.com/help/lemonjs/what-is-lemonjs
 */

const LEMON_JS_SRC = 'https://app.lemonsqueezy.com/js/lemon.js';

declare global {
	interface Window {
		LemonSqueezy?: {
			Url: { Open: (url: string) => void };
			/** Resolved once the script has initialised its globals. */
			loaded?: boolean;
		};
	}
}

let loadPromise: Promise<void> | null = null;

/** Inject <script src="lemon.js"> once; resolve when it's ready to use. */
function loadLemonJs(): Promise<void> {
	if (window.LemonSqueezy?.Url) return Promise.resolve();
	if (loadPromise) return loadPromise;

	loadPromise = new Promise<void>((resolve, reject) => {
		// A previous attempt may have left a dead tag behind.
		document.querySelector(`script[src="${LEMON_JS_SRC}"]`)?.remove();

		const script = document.createElement('script');
		script.src = LEMON_JS_SRC;
		script.defer = true;
		script.onload = () => resolve();
		script.onerror = () => {
			loadPromise = null; // allow a retry on the next click
			reject(new Error('Could not load the checkout — check your connection.'));
		};
		document.head.appendChild(script);
	});

	return loadPromise;
}

/**
 * Open a checkout URL in the overlay and resolve when the purchase completes
 * or the customer closes the overlay.
 *
 * Rejects only if Lemon.js itself fails to load — a customer dismissing the
 * overlay resolves as `{ completed: false }`, because abandoning a checkout
 * is a normal outcome, not an error worth a toast.
 */
export async function openCheckout(url: string): Promise<{ completed: boolean }> {
	await loadLemonJs();

	return new Promise<{ completed: boolean }>((resolve) => {
		let settled = false;
		const finish = (completed: boolean) => {
			if (settled) return;
			settled = true;
			// Listener cleanup: LS keeps one global event target, so leaving
			// these attached would leak a closure per abandoned checkout.
			window.removeEventListener('lemonsqueezy:success', onSuccess);
			window.removeEventListener('lemonsqueezy:close', onClose);
			resolve({ completed });
		};
		const onSuccess = () => finish(true);
		const onClose = () => finish(false);

		window.addEventListener('lemonsqueezy:success', onSuccess, { once: true });
		window.addEventListener('lemonsqueezy:close', onClose, { once: true });

		try {
			window.LemonSqueezy!.Url.Open(url);
		} catch (err) {
			finish(false);
			throw err;
		}
	});
}
