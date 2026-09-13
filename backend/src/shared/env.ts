import type { SessionRegistry } from "../state/SessionRegistry.ts";

export interface Env {
  // Bindings
  SessionRegistry: DurableObjectNamespace<SessionRegistry>;
  ASSETS: Fetcher;

  // vars (wrangler.jsonc)
  CREDITCOIN_RPC_URL: string;
  SOLUM_ASC_CONTRACT_ADDRESS: string;
  RELAYER_TOPUP_WEI: string;
  OTP_TTL_SECONDS: string;

  // secrets
  CREDITCOIN_FUNDER_PRIVATE_KEY?: string;
  SESSION_SECRET?: string;
  SMSGATE_USERNAME?: string;
  SMSGATE_PASSWORD?: string;
  SMSGATE_WEBHOOK_SECRET?: string;
  RESEND_API_KEY?: string;

  // vars (optional)
  EMAIL_FROM?: string;
}

/** House rule (from the sibling BinaText project): boot regardless, warn about what's disabled. */
export function checkReadiness(env: Env): string[] {
  const warnings: string[] = [];
  if (!env.SOLUM_ASC_CONTRACT_ADDRESS) warnings.push("SOLUM_ASC_CONTRACT_ADDRESS is unset — chain calls will fail.");
  if (!env.CREDITCOIN_FUNDER_PRIVATE_KEY) warnings.push("CREDITCOIN_FUNDER_PRIVATE_KEY is unset — relayer wallets cannot be gas-funded.");
  if (!env.SESSION_SECRET) warnings.push("SESSION_SECRET is unset — falling back to an insecure dev default, do not use in production.");
  for (const w of warnings) console.warn(`[solum] ${w}`);
  return warnings;
}

export function int(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(n) ? n : fallback;
}
