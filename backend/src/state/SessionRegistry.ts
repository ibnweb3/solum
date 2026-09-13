/**
 * SessionRegistry — one global Durable Object (SQLite-backed), pattern mirrors the sibling
 * BinaText project's AlertRegistry.
 *
 * Three jobs:
 *  1. OTP issuance/verification for the mocked email login (no real email is sent — the demo
 *     returns the code directly in the API response; see docs/attestcoin-integration.md's
 *     disclosed-simplifications section).
 *  2. Per-user relayer wallet custody — the gasless-onboarding backend's entire "no seed
 *     phrase" trick. Explicitly NOT production-grade custody: a private key in a Durable
 *     Object's SQLite storage is fine for a testnet demo, not for real funds.
 *  3. A light index of which applications belong to which user, so "my applications" doesn't
 *     require scanning the whole chain.
 */
import { DurableObject } from "cloudflare:workers";
import type { Env } from "../shared/env.ts";

export class SessionRegistry extends DurableObject<Env> {
  #sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.#sql = ctx.storage.sql;
    this.#sql.exec(
      `CREATE TABLE IF NOT EXISTS otp (
         email_hash TEXT PRIMARY KEY, code TEXT NOT NULL, expires INTEGER NOT NULL)`,
    );
    this.#sql.exec(
      `CREATE TABLE IF NOT EXISTS session (
         email_hash TEXT PRIMARY KEY, relayer_address TEXT NOT NULL,
         relayer_private_key TEXT NOT NULL, created INTEGER NOT NULL)`,
    );
    this.#sql.exec(
      `CREATE TABLE IF NOT EXISTS application (
         application_id INTEGER PRIMARY KEY, email_hash TEXT NOT NULL,
         deed_id INTEGER NOT NULL, created INTEGER NOT NULL)`,
    );
  }

  // ── OTP ──────────────────────────────────────────────────────────────────────────────────

  startLogin(emailHash: string, code: string, ttlSeconds: number): void {
    this.#sql.exec(
      `INSERT INTO otp (email_hash, code, expires) VALUES (?, ?, ?)
       ON CONFLICT(email_hash) DO UPDATE SET code = excluded.code, expires = excluded.expires`,
      emailHash,
      code,
      Date.now() + ttlSeconds * 1000,
    );
  }

  verifyLogin(emailHash: string, code: string): boolean {
    const row = this.#sql
      .exec<{ code: string; expires: number }>(`SELECT code, expires FROM otp WHERE email_hash = ?`, emailHash)
      .toArray()[0];
    if (!row || row.expires < Date.now() || row.code !== code) return false;
    this.#sql.exec(`DELETE FROM otp WHERE email_hash = ?`, emailHash);
    return true;
  }

  // ── Relayer wallets ──────────────────────────────────────────────────────────────────────

  getRelayer(emailHash: string): { address: string; privateKey: string } | null {
    const row = this.#sql
      .exec<{ relayer_address: string; relayer_private_key: string }>(
        `SELECT relayer_address, relayer_private_key FROM session WHERE email_hash = ?`,
        emailHash,
      )
      .toArray()[0];
    return row ? { address: row.relayer_address, privateKey: row.relayer_private_key } : null;
  }

  createRelayer(emailHash: string, address: string, privateKey: string): void {
    this.#sql.exec(
      `INSERT INTO session (email_hash, relayer_address, relayer_private_key, created) VALUES (?, ?, ?, ?)`,
      emailHash,
      address,
      privateKey,
      Date.now(),
    );
  }

  // ── Applications ─────────────────────────────────────────────────────────────────────────

  recordApplication(emailHash: string, applicationId: number, deedId: number): void {
    this.#sql.exec(
      `INSERT OR REPLACE INTO application (application_id, email_hash, deed_id, created) VALUES (?, ?, ?, ?)`,
      applicationId,
      emailHash,
      deedId,
      Date.now(),
    );
  }

  listApplications(emailHash: string): { applicationId: number; deedId: number }[] {
    return this.#sql
      .exec<{ application_id: number; deed_id: number }>(
        `SELECT application_id, deed_id FROM application WHERE email_hash = ? ORDER BY created DESC`,
        emailHash,
      )
      .toArray()
      .map((r) => ({ applicationId: r.application_id, deedId: r.deed_id }));
  }
}
