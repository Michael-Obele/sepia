import * as v from 'valibot';

/**
 * Billing types + schemas shared by the checkout remote function and the UI.
 *
 * WHY THIS FILE EXISTS (it used to live in `remote/billing.remote.ts`):
 * SvelteKit's remote-function transform requires EVERY value export from a
 * `.remote.ts` file to be a remote function. A bare `export const SomeSchema`
 * fails the build with
 *
 *   `SomeSchema` exported from src/lib/remote/billing.remote.ts is invalid —
 *   all exports from this file must be remote functions
 *
 * and the failure is not a compile error — it throws while the module is being
 * imported during SSR, so every page that imports the remote barrel 500s at
 * runtime. (Types and `interface`s are fine; only value exports are rejected.)
 *
 * SvelteKit documents the constraint: "you cannot export a schema from a
 * `.remote.ts` or `.remote.js` file, so the schema must either be exported from
 * a shared module, or from a `<script module>` block in the component."
 * This is that shared module.
 *
 * Keep it dependency-free apart from valibot — it is imported by both server
 * and client code.
 */

/** The two variants of the single "Sepia Pro" product. */
export const BillingPeriod = v.union([v.literal('monthly'), v.literal('annual')]);
export type BillingPeriod = v.InferOutput<typeof BillingPeriod>;

export interface CheckoutResult {
	/** Open this with LemonSqueezy.Url.Open(url). */
	url: string;
	period: BillingPeriod;
}
