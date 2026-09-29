import { command } from '$app/server';
import * as v from 'valibot';
import { env } from '$env/dynamic/private';
import { requireAuth } from '$lib/server/auth';

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

/** The two variants of the single "Sepia Pro" product. */
export const BillingPeriod = v.union([v.literal('monthly'), v.literal('annual')]);
export type BillingPeriod = v.InferOutput<typeof BillingPeriod>;

export interface CheckoutResult {
	/** Open this with LemonSqueezy.Url.Open(url). */
	url: string;
	period: BillingPeriod;
}

const LS_API = 'https://api.lemonsqueezy.com/v1/checkouts';

/**
 * Env is read lazily inside the command (not at module load) so a missing
 * var produces a clear runtime error on click rather than crashing the build.
 */
function requireEnv(name: string): string {
	const value = env[name];
	if (!value) {
		console.error(`[billing] ${name} is not set — checkout unavailable`);
		throw new Error('Billing is not configured yet — please try again later.');
	}
	return value;
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
	const apiKey = requireEnv('LEMONSQUEEZY_API_KEY');
	const storeId = requireEnv('LEMONSQUEEZY_STORE_ID');
	const variantId = variantIdFor(period);

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
							// Hosted (non-overlay) completion lands here. The
							// overlay closes itself, but this covers the case
							// where the browser blocks it.
							redirect_url: `${env.APP_URL ?? 'https://sepia.svelte-apps.me'}/app/account?checkout=success`,
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
