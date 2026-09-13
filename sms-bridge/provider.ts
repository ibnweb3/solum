/**
 * SMS provider interface, copied near-verbatim from the sibling BinaText project
 * (binatext/src/sms/provider.ts) — this part is already generic, not BinaText-specific.
 * Solum only wires up sms-gate.app (no Twilio fallback; SMS is the first thing cut if the
 * hackathon deadline is tight, so one provider is enough).
 */
import type { Env } from "../backend/src/shared/env.ts";
import { smsgateProvider } from "./smsgate.ts";

export interface InboundSms {
  /** Sender, E.164. */
  from: string;
  /** Message text, trimmed by the provider adapter of provider-added prefixes. */
  body: string;
  /** Provider message id — used for inbound de-duplication (providers retry). */
  msgId: string;
}

/** Thrown when a signature header is present but doesn't verify — caller responds 403. */
export class BadSignatureError extends Error {}

export interface SmsProvider {
  readonly name: string;
  verifyAndParse(req: Request, env: Env): Promise<InboundSms | null>;
  send(to: string, body: string, env: Env): Promise<void>;
  ackResponse(): Response;
}

export function getSmsProvider(_env: Env): SmsProvider {
  return smsgateProvider;
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
