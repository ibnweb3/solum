import type { Env } from "../shared/env.ts";

/**
 * Sends the OTP via Resend when configured. Note: without a verified sending domain, Resend's
 * shared test sender (`onboarding@resend.dev`) can only deliver to the email address that owns
 * the Resend account — not to arbitrary sign-ins. Verify a domain in Resend and set EMAIL_FROM
 * to unlock sending to anyone. Returns false (never throws) on any failure so the caller can
 * fall back to the dev-code flow rather than breaking sign-in.
 */
export async function sendOtpEmail(env: Env, to: string, code: string): Promise<boolean> {
  if (!env.RESEND_API_KEY) return false;
  const from = env.EMAIL_FROM || "Solum <onboarding@resend.dev>";

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from,
        to,
        subject: "Your Solum verification code",
        html: `<p>Your Solum sign-in code is <strong>${code}</strong>. It expires in 10 minutes.</p>`,
        text: `Your Solum sign-in code is ${code}. It expires in 10 minutes.`,
      }),
    });
    if (!res.ok) {
      console.error(`[solum] Resend send failed ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[solum] Resend send threw: ${(err as Error).message}`);
    return false;
  }
}
