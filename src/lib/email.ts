/**
 * Transactional email via Resend (free tier: 3,000/mo, 100/day).
 *
 * Plain fetch — no SDK dependency. The sender is a thin wrapper so a later
 * switch to Amazon SES (or another provider) is a one-file change.
 *
 * Env:
 *   RESEND_API_KEY    — required to send (Resend dashboard → API Keys)
 *   RESEND_FROM_EMAIL — sender address, e.g. "Sepia <no-reply@sepia.svelte-apps.me>"
 *                       (must be a verified domain in Resend)
 */

const RESEND_URL = "https://api.resend.com/emails";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Send an email. Never throws on send failure — logs and continues (a failed
 * reset email must not take down the request; the rate limit still applies).
 */
export async function sendEmail(msg: EmailMessage): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[email] RESEND_API_KEY not set — skipping email send");
    return;
  }
  const from =
    process.env.RESEND_FROM_EMAIL ?? "Sepia <no-reply@sepia.svelte-apps.me>";
  try {
    const res = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from,
        to: msg.to,
        subject: msg.subject,
        text: msg.text,
        ...(msg.html ? { html: msg.html } : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(
        `[email] Resend error ${res.status}: ${body.slice(0, 300)}`,
      );
    }
  } catch (e) {
    console.error("[email] send failed:", e);
  }
}

/** The public base URL for links in emails (reset links, verification). */
export function appUrl(): string {
  return (
    process.env.APP_URL ??
    process.env.BETTER_AUTH_URL ??
    process.env.OAUTH_ISSUER_URL ??
    "https://sepia.svelte-apps.me"
  );
}
