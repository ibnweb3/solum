/**
 * Mocked email login + signed session cookie. No real email is ever sent — this is an
 * explicitly disclosed hackathon-demo simplification (see docs/attestcoin-integration.md).
 * The OTP is returned directly in the API response so the flow is fully demoable offline.
 */
import type { Env } from "../shared/env.ts";

const DEV_SESSION_SECRET = "solum-dev-insecure-secret-do-not-use-in-production";
export const SESSION_COOKIE_NAME = "solum_session";

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function emailHash(email: string): Promise<string> {
  return sha256Hex(email.trim().toLowerCase());
}

export function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function signSession(env: Env, hash: string): Promise<string> {
  const sig = await hmacHex(env.SESSION_SECRET ?? DEV_SESSION_SECRET, hash);
  return `${hash}.${sig}`;
}

export async function verifySessionCookie(env: Env, cookieValue: string | null): Promise<string | null> {
  if (!cookieValue) return null;
  const [hash, sig] = cookieValue.split(".");
  if (!hash || !sig) return null;
  const expected = await hmacHex(env.SESSION_SECRET ?? DEV_SESSION_SECRET, hash);
  return expected === sig ? hash : null;
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  const match = header
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}
