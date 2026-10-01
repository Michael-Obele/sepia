import { command, getRequestEvent } from '$app/server';
import { env } from '$env/dynamic/private';
import { requireAuth } from '$lib/server/auth';
import { BillingPeriod, type CheckoutResult } from '$lib/billing';

export type { BillingPeriod, CheckoutResult } from '$lib/billing';

/**
 * Lemon Squeezy checkout creation.
 *
 * WHY HERE (and not on the Fly server, which is where the webhook lives):
 * `src/auth.ts` on Fly deliberately rejects dashboard browser sessions — a
 * leaked MCP credential must not be exchangeable for one — so the Fly API has
 * no way to authenticate an arbitrary signed-in dashboard user. This surface
 * already resolves the session server-side (`requireAuth`), so checkout
 * creation belongs here: it makes an OUTBOUND call to LS's API, and the API
 * key lives in Netlify's private env — it never reaches the browser.
 *
 * Flow: createCheckout → URL → Lemon.js overlay (`LemonSqueezy.Url.Open`) →
 * LS processes the payment → `meta.custom_data.user_id` comes back on the
 * webhook → Fly flips `users.plan`. The webhook is the source of truth; this
 * function only opens the door.
 *
 * Docs: https://docs.lemonsqueezy.com/api/checkouts/create-checkout
 */

const LS_API = 'https://api.lemonsqueezy.com/v1/checkouts';

/**
 * Env is read lazily inside the command (not at module load) so a missing
 * var produces a clear runtime error on click rather than crashing the build.
 *
 * The `if (!value)` check is deliberate rather than `??` downstream: it also
 * rejects the EMPTY STRING, which `??` lets through.
 */
function requireEnv(name: string): string {
	const value = env[name];
	if (!value) {
		console.error(`[billing] ${name} is not set — checkout unavailable`);
		throw new Error('Billing is not configured yet — please try again later.');
	}
	return value;
}

/** Where the app lives when `APP_URL` is not configured (e.g. local dev). */
const DEFAULT_APP_ORIGIN = 'https://sepia.svelte-apps.me';

/** Hostnames that can only ever be this machine (local dev). */
function isLoopback(hostname: string): boolean {
	return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

/**
 * Absolute origin used to build LS's `redirect_url` — where the customer
 * lands after a HOSTED (non-overlay) checkout completes.
 *
 * Validated, not concatenated. LS bounces the customer to this URL the moment
 * payment completes, so a malformed value here is an open redirect on the
 * checkout. The two realistic ways to get one are operator error:
 * `APP_URL=//evil.com` (protocol-relative) or `APP_URL=` (empty), either of
 * which would be handed straight to a third party as a URL to redirect to.
 *
 * Precedence (fixes U2 — "Open Dashboard leaves the dev environment"):
 *   1. IN DEV, the loopback request origin wins. `dashboard/.env` pins
 *      `APP_URL` to the production site, so on `:5175` the post-payment
 *      bounce used to send a customer who just paid in DEV to PROD —
 *      dropping the very session they upgraded. "In dev" is the Vite
 *      BUILD-TIME flag `import.meta.env.DEV`, never a request header: a
 *      crafted `Host` must not be able to pick the target of a payment
 *      redirect (forge review: MEDIUM — header-controlled rank 3).
 *   2. `APP_URL` when set (operator intent; validated).
 *   3. The production default, so checkout never hard-fails on config alone
 *      (`APP_URL` is not in `netlify.toml`'s documented set).
 *
 * Allowed: any https origin, plus plain http on loopback ONLY (the dev
 * server has no TLS). Everything else throws before any network call.
 */
function requireAppOrigin(): string {
	// Build-time dev detection + loopback check — request input is only
	// consulted when DEV is true, so production never reads a client header.
	let local: URL | null = null;
	if (import.meta.env.DEV) {
		try {
			const request = new URL(getRequestEvent().url);
			if (isLoopback(request.hostname)) local = request;
		} catch {
			// No request context — fall back to config.
		}
	}

	const raw = local ? local.origin : env.APP_URL || DEFAULT_APP_ORIGIN;

	let parsed: URL;
	try {
		parsed = new URL(raw);
	} catch {
		console.error(`[billing] app origin is not a valid URL: ${JSON.stringify(raw)}`);
		throw new Error('Billing is not configured yet — please try again later.');
	}
	const allowed =
		parsed.protocol === 'https:' || (parsed.protocol === 'http:' && isLoopback(parsed.hostname));
	if (!allowed) {
		console.error(`[billing] app origin must be https (or localhost dev), got: ${raw}`);
		throw new Error('Billing is not configured yet — please try again later.');
	}
	return parsed.origin;
}

function variantIdFor(period: BillingPeriod): string {
	return requireEnv(
		period === 'annual'
			? 'LEMONSQUEEZY_VARIANT_ID_PRO_ANNUAL'
			: 'LEMONSQUEEZY_VARIANT_ID_PRO_MONTHLY'
	);
}

/** The counterpart variant, so checkout can offer switching periods. */
function otherVariantId(variantId: string): string {
	const monthly = requireEnv('LEMONSQUEEZY_VARIANT_ID_PRO_MONTHLY');
	const annual = requireEnv('LEMONSQUEEZY_VARIANT_ID_PRO_ANNUAL');
	return variantId === monthly ? annual : monthly;
}

/**
 * Create a hosted checkout for the current user and return its URL.
 *
 * `checkout_data.custom.user_id` is the whole hinge of the integration: LS
 * echoes it back as `meta.custom_data.user_id` on every order/subscription
 * webhook, which is how Fly knows WHICH user to upgrade. Prefilling the email
 * too: fewer fields for the customer, and it backs the webhook's email
 * fallback if the custom data is ever stripped.
 *
 * Throws (→ toast + re-enabled button) when billing is unconfigured or LS
 * errors. Nothing is written locally — state only changes when the webhook
 * lands, so a failed call leaves no partial state.
 */
export const createCheckout = command(BillingPeriod, async (period): Promise<CheckoutResult> => {
	const user = await requireAuth();

	// Read and validate ALL config BEFORE the network try/catch. Inside it, a
	// config error would be caught by the network handler and reported to the
	// customer as "could not reach the payment provider" — wrong message, and
	// a log line that lies about the cause. The operator-facing
	// `console.error` from requireEnv/requireAppOrigin still fires either way.
	const apiKey = requireEnv('LEMONSQUEEZY_API_KEY');
	const storeId = requireEnv('LEMONSQUEEZY_STORE_ID');
	const variantId = variantIdFor(period);
	const appOrigin = requireAppOrigin();
	// MUST point at the route that owns the `?checkout=success` handler, which
	// is now `/app/settings/plan` (Plan & usage). It used to be `/app/account`;
	// that route is a 308 redirect, and a 308 to a fixed path DROPS the query
	// string — so the "payment confirmed" banner would silently never appear.
	const checkoutUrl = `${appOrigin}/app/settings/plan?checkout=success`;

	let res: Response;
	try {
		res = await fetch(LS_API, {
			method: 'POST',
			headers: {
				Accept: 'application/vnd.api+json',
				'Content-Type': 'application/vnd.api+json',
				Authorization: `Bearer ${apiKey}`
			},
			body: JSON.stringify({
				data: {
					type: 'checkouts',
					attributes: {
						// Overlay keeps the customer on our page; the button's
						// onclick opens it with LemonSqueezy.Url.Open().
						checkout_options: { embed: true },
						checkout_data: {
							email: user.email,
							name: user.name,
							custom: { user_id: user.id }
						},
						product_options: {
							// U4: the STORE's product name/description are a
							// different pitch ("…7 MCP tools", an AI list the
							// pricing page never shows). These per-checkout
							// overrides make the checkout read like our own page —
							// the moment of truth must not introduce a new product.
							name: 'Sepia Pro',
							description:
								'One graph for every AI you use. Locked in at beta pricing. 100 namespaces, 1,000,000 memories, unlimited Web AI connections — AI editors always unlimited.',
							// Hosted (non-overlay) completion lands here; also the
							// target of the confirmation screen's "Open Dashboard"
							// button when the overlay path is unavailable.
							redirect_url: checkoutUrl,
							// The store carries a leftover auto-created "Default"
							// variant alongside Monthly/Yearly. With this unset LS
							// shows EVERY variant as a picker option at checkout —
							// so pin the list to the two we actually sell.
							enabled_variants: [variantId, otherVariantId(variantId)]
						}
					},
					relationships: {
						store: { data: { type: 'stores', id: String(storeId) } },
						variant: { data: { type: 'variants', id: String(variantId) } }
					}
				}
			})
		});
	} catch (err) {
		// Network failure — LS is down or unreachable from Netlify.
		console.error('[billing] LS API unreachable:', err);
		throw new Error('Could not reach the payment provider — please try again.');
	}

	if (!res.ok) {
		// LS error bodies are structured ({ errors: [{ detail }] }). Log the
		// full body server-side; the customer only gets the safe message.
		const detail = await res.text().catch(() => '');
		console.error(`[billing] LS checkout failed: ${res.status} ${detail}`);
		throw new Error('Could not start checkout — please try again in a moment.');
	}

	const payload = (await res.json()) as {
		data?: { attributes?: { url?: string } };
	};
	const url = payload.data?.attributes?.url;
	if (!url) {
		console.error('[billing] LS returned no checkout URL:', payload);
		throw new Error('Could not start checkout — please try again in a moment.');
	}

	return { url, period };
});
