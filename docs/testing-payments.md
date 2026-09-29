# Testing Lemon Squeezy payments

How to run a test purchase for Sepia Pro end-to-end without moving real money,
and how to tell whether each stage worked.

## 0. Make sure you're in Test mode

The toggle is top-right in the [Lemon Squeezy dashboard](https://app.lemonsqueezy.com).
A new store starts in test mode. Two things are true about test mode:

- **API keys are per-mode.** A key created in test mode only sees test data.
  The `LEMONSQUEEZY_API_KEY` in your `.env` is a test key until you make a
  live one.
- **Webhooks are per-mode.** A webhook registered in test mode only fires for
  test purchases. Before launch you must create a **second** webhook (and a
  live API key) in live mode — same URL, same 12 events.

Test purchases write to your **real database** — there is no separate test DB.
That is what makes the test useful, and why you should reset the plan
afterwards (see [Reset](#reset-after-testing)).

## 1. Test cards

Use these on the checkout. **Never use a real card** — LS treats real card
details entered for testing as fraud and can suspend the store.

| Card | Number | Use it to test |
| --- | --- | --- |
| Visa | `4242 4242 4242 4242` | the happy path |
| Mastercard | `5555 5555 5555 4444` | a second brand |
| American Express | `3782 822463 10005` | Amex flow |
| Insufficient funds | `4000 0000 0000 9995` | `subscription_payment_failed` |
| Expired card | `4000 0000 0000 0069` | declined renewal |
| 3D Secure | `4000 0027 6000 3184` | the 3DS challenge step |

Other fields:

- **Expiry:** any future date — `12/35` works
- **CVC:** any 3 digits — `123`
- **Name / address / ZIP:** anything

## 2. Run a purchase

1. Sign in to the dashboard (`https://sepia.svelte-apps.me`) as a **non-pro**
   user — signing in first is what lets the checkout carry your `user_id`.
2. Go to **Pricing** → click **Get Pro** (or Account → **Upgrade to Pro**).
   The checkout opens as an overlay; you stay on the page.
3. Fill in a test card above and pay.
4. The overlay closes and the page shows *"You're on Pro"*.

If the overlay is blocked by the browser, LS redirects to
`/app/account?checkout=success` instead — same test, different delivery.

## 3. Confirm each stage

| Stage | Where to look | Passing |
| --- | --- | --- |
| Payment | LS → **Orders** | order listed, status paid, `test_mode` on |
| Webhook fired | LS → **Settings » Webhooks** → your webhook | recent delivery, `2xx`, payload shown |
| Webhook verified + applied | Fly logs (`fly logs`) | `[billing] subscription_created → user=… plan=pro` |
| Plan flipped | Account page, or `select plan from users where email=…` | `pro` |
| Limits raised | Account usage meters | 100 namespaces / 1,000,000 memories |

**If the order exists but the plan didn't flip**, the webhook is the suspect.
In LS → Webhooks, expand the delivery:

- **No delivery at all** → wrong URL (must be
  `https://sepia.fly.dev/api/webhooks/lemonsqueezy`) or the webhook isn't
  created yet.
- **`401 invalid_signature`** → the secret in `.env` / `fly secrets` differs
  from the one typed into the webhook's *Signing secret* field.
- **`503 billing_not_configured`** → `LEMONSQUEEZY_WEBHOOK_SECRET` isn't set
  on Fly.
- **`200` but no change** → check the log line's reason; most often
  `no_user`, meaning the checkout didn't carry `custom_data.user_id` — so you
  opened checkout while signed out.

LS retries automatically on non-2xx, and the **Recent** list has a **resend**
button — fix the cause, then resend rather than buying again.

## 4. Exercising the failure events

The downgrade path matters more than the upgrade, so test it too:

- **Cancel** → LS → Subscriptions → Cancel. The plan stays `pro` until
  `ends_at` (grace period) — `subscription_cancelled` is deliberately a no-op.
- **Expire** → after grace, `subscription_expired` sets the plan back to
  `free`. For a fast test, cancel and then edit the subscription's end date
  in LS to now.
- **Failed renewal** → pay with `4000 0000 0000 9995`. Expect
  `subscription_payment_failed` in the logs and the plan **unchanged** —
  dunning must not lock a paying customer out mid-retry.

## Reset after testing

Test purchases are real rows in your real DB. To put a user back:

```sql
update users
set plan = 'free',
    lemon_customer_id = null,
    lemon_subscription_id = null
where email = 'you@example.com';
```

Then void/cancel the test order in LS so it doesn't linger as an active
subscription. Test orders never charge anyone, but an active one will keep
emitting `subscription_payment_success` on its renewal date and flip the plan
back to `pro`.

## Before going live

1. Activate the store (LS → Settings).
2. **Copy to Live Mode** the *Sepia Pro* product (⋮ on the product row) —
   test-mode products do not transfer automatically.
3. Create a **live** API key (Settings » API) and replace
   `LEMONSQUEEZY_API_KEY`.
4. Create a **live** webhook (Settings » Webhooks): same URL, same 12 events,
   and a signing secret — if you reuse the test secret, keep it in sync across
   both.
5. Set the live variant ids in Netlify env if they differ from
   `2104269` / `2104382`.
6. Buy one real subscription yourself before announcing anything.

## Related

- Design + event→plan mapping: `docs/plans/2026-09-29-lemon-squeezy-billing-design.md`
- Secret-leak guard: `scripts/no-secrets.test.ts` (`bun test scripts/no-secrets.test.ts`)
