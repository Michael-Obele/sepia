import { invalidateAll } from '$app/navigation';
import { toast } from 'svelte-sonner';
import { getMe } from '$lib/remote/index.js';
import { fresh } from '$lib/fresh';

/**
 * Post-payment confirmation: poll until the webhook flips the plan.
 *
 * WHY THIS EXISTS (U1): the old flow toasted "Plan updated from the payment
 * webhook" the instant the overlay's `Checkout.Success` postMessage arrived —
 * a claim the CLIENT cannot verify. The webhook is asynchronous: the order
 * has to travel LS → Fly → Neon, and until it lands the account page still
 * says Free while the toast says Pro. The same applies to LS's hosted
 * fallback, which redirects here with `?checkout=success`.
 *
 * So: show a "Confirming" state, re-read the plan (memoized queries are
 * busted via `invalidateAll()` + `fresh()`), and only claim success once a
 * server read actually shows a non-free plan. If the webhook is slow, say
 * THAT — "payment received, activating" — instead of asserting something we
 * have not seen.
 *
 * ~30s budget: the webhook landed within seconds in every live test; this is
 * a wait, not a hang (the overlay promise has its own separate watchdog).
 */
const POLL_INTERVAL_MS = 1500;
const POLL_TRIES = 20;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Returns `true` once the plan is confirmed flipped, `false` if the webhook
 * has not landed within the budget. The caller does not act on the result —
 * the toasts above already told the customer the honest state — but the
 * boolean keeps the door open for callers that want to.
 */
export async function confirmPayment(): Promise<boolean> {
	const id = toast.loading('Confirming your payment…', {
		description: 'Waiting for the payment webhook — usually just a few seconds.'
	});
	try {
		for (let attempt = 0; attempt < POLL_TRIES; attempt++) {
			await invalidateAll();
			// `fresh()` forces a refetch: SvelteKit memoizes queries by
			// (function, args), so re-awaiting the same call would replay the
			// pre-webhook result forever.
			const me = await fresh(getMe()).catch(() => null);
			if (me && me.user.plan !== 'free') {
				toast.dismiss(id);
				toast.success("You're on Pro — welcome aboard", {
					description: 'Your plan is active. Everything is unlocked.'
				});
				return true;
			}
			if (attempt < POLL_TRIES - 1) await sleep(POLL_INTERVAL_MS);
		}
	} catch {
		// Fall through to the honest "still activating" message below.
	}
	toast.dismiss(id);
	toast.info('Payment received', {
		description: 'Your plan is activating — it will show here in a moment.'
	});
	return false;
}
