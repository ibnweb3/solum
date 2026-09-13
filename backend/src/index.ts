/**
 * Solum backend Worker. Routes:
 *   POST /api/login/start    {email} -> {devCode}                  (mocked OTP, see auth/session.ts)
 *   POST /api/login/verify   {email, otp} -> sets session cookie
 *   POST /api/apply          {deedId, propertyValueUsd, loanAmount} -> plain-English decision
 *   GET  /api/status/:id     -> plain-English status (also used by the SMS bridge)
 *   GET  /api/my-applications -> the logged-in user's past applications
 *   *    /sms/smsgate         -> SMS status-check webhook (Phase 4)
 *   *    (everything else)    -> static frontend (frontend/index.html)
 */
import { SessionRegistry } from "./state/SessionRegistry.ts";
import { checkReadiness, type Env } from "./shared/env.ts";
import { emailHash, generateOtp, readCookie, SESSION_COOKIE_NAME, signSession, verifySessionCookie } from "./auth/session.ts";
import { getOrCreateRelayerWallet } from "./relayer/wallet.ts";
import { submitMortgageApplication } from "./relayer/submit.ts";
import { lookupApplicationStatus } from "./status/lookup.ts";
import { BadSignatureError, getSmsProvider } from "../../sms-bridge/provider.ts";
import { handleStatusCommand } from "../../sms-bridge/statusHandler.ts";

export { SessionRegistry };

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    checkReadiness(env);
    const url = new URL(request.url);

    try {
      if (url.pathname === "/api/login/start" && request.method === "POST") return handleLoginStart(request, env);
      if (url.pathname === "/api/login/verify" && request.method === "POST") return handleLoginVerify(request, env);
      if (url.pathname === "/api/apply" && request.method === "POST") return handleApply(request, env);
      if (url.pathname === "/api/my-applications" && request.method === "GET") return handleMyApplications(request, env);

      const statusMatch = url.pathname.match(/^\/api\/status\/(\d+)$/);
      if (statusMatch && request.method === "GET") {
        const view = await lookupApplicationStatus(env, Number(statusMatch[1]));
        return json(view);
      }

      if (url.pathname === "/sms/smsgate" && request.method === "POST") return handleSms(request, env, ctx);

      return env.ASSETS.fetch(request);
    } catch (err) {
      console.error(`[solum] ${url.pathname}: ${(err as Error).stack ?? err}`);
      return json({ error: "internal_error" }, { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;

// ── Login (mocked OTP) ────────────────────────────────────────────────────────────────────────

async function handleLoginStart(request: Request, env: Env): Promise<Response> {
  const { email } = await request.json<{ email?: string }>();
  if (!email || !email.includes("@")) return json({ error: "invalid_email" }, { status: 400 });

  const hash = await emailHash(email);
  const code = generateOtp();
  const ttlSeconds = Number(env.OTP_TTL_SECONDS || "600");

  const registry = env.SessionRegistry.get(env.SessionRegistry.idFromName("global"));
  await registry.startLogin(hash, code, ttlSeconds);

  console.log(`[solum] OTP for ${email}: ${code} (demo-only, not actually emailed)`);
  // Demo simplification: no real email is sent. The code is returned directly so the flow is
  // fully testable end to end without an email provider. Disclosed in the README.
  return json({ ok: true, devCode: code });
}

async function handleLoginVerify(request: Request, env: Env): Promise<Response> {
  const { email, otp } = await request.json<{ email?: string; otp?: string }>();
  if (!email || !otp) return json({ error: "missing_fields" }, { status: 400 });

  const hash = await emailHash(email);
  const registry = env.SessionRegistry.get(env.SessionRegistry.idFromName("global"));
  const ok = await registry.verifyLogin(hash, otp);
  if (!ok) return json({ error: "invalid_or_expired_code" }, { status: 401 });

  const cookieValue = await signSession(env, hash);
  return json(
    { ok: true },
    {
      headers: {
        "Set-Cookie": `${SESSION_COOKIE_NAME}=${encodeURIComponent(cookieValue)}; Path=/; HttpOnly; SameSite=Lax`,
      },
    },
  );
}

async function requireSession(request: Request, env: Env): Promise<string | null> {
  return verifySessionCookie(env, readCookie(request, SESSION_COOKIE_NAME));
}

// ── Mortgage application (gasless) ───────────────────────────────────────────────────────────

async function handleApply(request: Request, env: Env): Promise<Response> {
  const hash = await requireSession(request, env);
  if (!hash) return json({ error: "not_logged_in" }, { status: 401 });

  const { deedId, propertyValueUsd, loanAmount } = await request.json<{
    deedId?: number;
    propertyValueUsd?: number;
    loanAmount?: number;
  }>();
  if (!deedId || !propertyValueUsd || !loanAmount) {
    return json({ error: "missing_fields" }, { status: 400 });
  }

  const relayer = await getOrCreateRelayerWallet(env, hash);
  const result = await submitMortgageApplication(env, relayer, deedId, propertyValueUsd, loanAmount);

  const registry = env.SessionRegistry.get(env.SessionRegistry.idFromName("global"));
  await registry.recordApplication(hash, result.applicationId, result.deedId);

  const view = await lookupApplicationStatus(env, result.applicationId);
  return json({ ...result, plainEnglish: view.plainEnglish });
}

async function handleMyApplications(request: Request, env: Env): Promise<Response> {
  const hash = await requireSession(request, env);
  if (!hash) return json({ error: "not_logged_in" }, { status: 401 });

  const registry = env.SessionRegistry.get(env.SessionRegistry.idFromName("global"));
  const applications = await registry.listApplications(hash);
  return json({ applications });
}

// ── SMS status-check (Phase 4) ───────────────────────────────────────────────────────────────

async function handleSms(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const provider = getSmsProvider(env);

  let inbound;
  try {
    inbound = await provider.verifyAndParse(request, env);
  } catch (err) {
    if (err instanceof BadSignatureError) return new Response("bad signature", { status: 403 });
    throw err;
  }
  if (!inbound) return provider.ackResponse();

  ctx.waitUntil(
    handleStatusCommand(inbound.body, env)
      .then((reply) => provider.send(inbound.from, reply, env))
      .catch((err) => console.error(`[solum] sms handling failed: ${(err as Error).stack ?? err}`)),
  );
  return provider.ackResponse();
}
