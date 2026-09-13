/**
 * SMS Gateway for Android (sms-gate.app) adapter — copied from the sibling BinaText project
 * (binatext/src/sms/smsgate.ts), same webhook signature verification and send() call shape.
 * Needs its own device/account for Solum (not the BinaText one) — see docs for setup.
 */
import type { Env } from "../backend/src/shared/env.ts";
import { BadSignatureError, timingSafeEqual, type InboundSms, type SmsProvider } from "./provider.ts";

const API_BASE = "https://api.sms-gate.app/3rdparty/v1";

class BadPhoneNumberError extends Error {}

function normalizeE164(raw: string): string {
  const trimmed = raw.trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/[^\d]/g, "");
  const e164 = `+${digits}`;
  if (!hasPlus || !/^\+[1-9]\d{7,14}$/.test(e164)) {
    throw new BadPhoneNumberError(`"${raw}" is not a valid E.164 phone number`);
  }
  return e164;
}

interface SmsGateWebhook {
  event?: string;
  payload?: {
    messageId?: string;
    message?: string;
    phoneNumber?: string;
  };
}

export const smsgateProvider: SmsProvider = {
  name: "smsgate",

  async verifyAndParse(req, env): Promise<InboundSms | null> {
    const raw = await req.text();

    // sms-gate.app signs webhooks HMAC-SHA256 over `${timestamp}${rawBody}`,
    // header `x-signature` (hex), timestamp in `x-timestamp`.
    if (env.SMSGATE_WEBHOOK_SECRET) {
      const sig = req.headers.get("x-signature");
      const ts = req.headers.get("x-timestamp") ?? "";
      if (!sig || !(await validSig(env.SMSGATE_WEBHOOK_SECRET, ts + raw, sig))) {
        throw new BadSignatureError("sms-gate webhook signature mismatch");
      }
    }

    let data: SmsGateWebhook;
    try {
      data = JSON.parse(raw) as SmsGateWebhook;
    } catch {
      return null;
    }
    if (data.event && data.event !== "sms:received") return null;

    const sender = data.payload?.phoneNumber;
    const message = data.payload?.message;
    const messageId = data.payload?.messageId;
    if (!sender || message === undefined || !messageId) return null;

    try {
      return { from: normalizeE164(sender), body: message.trim(), msgId: messageId };
    } catch {
      return null;
    }
  },

  async send(to, body, env): Promise<void> {
    const { SMSGATE_USERNAME: user, SMSGATE_PASSWORD: pass } = env;
    if (!user || !pass) {
      console.warn(`[smsgate] send skipped (no creds): "${body.slice(0, 60)}"`);
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/messages`, {
        method: "POST",
        headers: {
          authorization: `Basic ${btoa(`${user}:${pass}`)}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ message: body, phoneNumbers: [to] }),
      });
      if (!res.ok) {
        console.error(`[smsgate] send ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }
    } catch (err) {
      console.error(`[smsgate] send threw: ${(err as Error).message}`);
    }
  },

  ackResponse(): Response {
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" },
    });
  },
};

async function validSig(secret: string, data: string, sig: string): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  const want = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return timingSafeEqual(want, sig.trim().toLowerCase());
}
