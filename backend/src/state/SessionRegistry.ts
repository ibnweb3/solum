/**
 * SessionRegistry — one global Durable Object (SQLite-backed), pattern mirrors the sibling
 * BinaText project's AlertRegistry.
 *
 * Four jobs:
 *  1. OTP issuance/verification for email login (real send via Resend when configured, with an
 *     on-screen fallback code otherwise — see email/resend.ts).
 *  2. Per-user relayer wallet custody — the gasless-onboarding backend's entire "no seed
 *     phrase" trick. Explicitly NOT production-grade custody: a private key in a Durable
 *     Object's SQLite storage is fine for a testnet demo, not for real funds.
 *  3. A per-user activity ledger: every application, which deed document it was made with, its
 *     decision, and its disbursement/repayment progress — the data a dashboard needs, without
 *     re-scanning the whole chain.
 *  4. Loan repayment bookkeeping (illustrative — see docs/attestcoin-integration.md): tracks how
 *     much of a disbursed loan has been repaid so the app can show progress and know when it's
 *     done.
 */
import { DurableObject } from "cloudflare:workers";
import type { Env } from "../shared/env.ts";

export interface ApplicationRow {
  applicationId: number;
  emailHash: string;
  deedId: number;
  deedFileName: string | null;
  status: string;
  loanAmount: string;
  propertyValueUsd: string;
  disbursedWei: string;
  repaidWei: string;
  created: number;
}

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
    // SQLite has no "ADD COLUMN IF NOT EXISTS" — guard each migration so this stays safe to run
    // against an already-deployed database that predates these columns.
    for (const stmt of [
      `ALTER TABLE application ADD COLUMN deed_file_name TEXT`,
      `ALTER TABLE application ADD COLUMN status TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE application ADD COLUMN loan_amount TEXT NOT NULL DEFAULT '0'`,
      `ALTER TABLE application ADD COLUMN property_value_usd TEXT NOT NULL DEFAULT '0'`,
      `ALTER TABLE application ADD COLUMN disbursed_wei TEXT NOT NULL DEFAULT '0'`,
      `ALTER TABLE application ADD COLUMN repaid_wei TEXT NOT NULL DEFAULT '0'`,
    ]) {
      try {
        this.#sql.exec(stmt);
      } catch {
        /* column already exists */
      }
    }
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

  // ── Applications / activity ledger ──────────────────────────────────────────────────────

  recordApplication(
    emailHash: string,
    applicationId: number,
    deedId: number,
    deedFileName: string | null,
    status: string,
    loanAmount: number,
    propertyValueUsd: number,
  ): void {
    this.#sql.exec(
      `INSERT OR REPLACE INTO application
         (application_id, email_hash, deed_id, deed_file_name, status, loan_amount, property_value_usd,
          disbursed_wei, repaid_wei, created)
       VALUES (?, ?, ?, ?, ?, ?, ?, '0', '0', ?)`,
      applicationId,
      emailHash,
      deedId,
      deedFileName,
      status,
      String(loanAmount),
      String(propertyValueUsd),
      Date.now(),
    );
  }

  recordDisbursement(applicationId: number, amountWei: string): void {
    this.#sql.exec(`UPDATE application SET disbursed_wei = ? WHERE application_id = ?`, amountWei, applicationId);
  }

  recordRepayment(applicationId: number, newRepaidWei: string): void {
    this.#sql.exec(`UPDATE application SET repaid_wei = ? WHERE application_id = ?`, newRepaidWei, applicationId);
  }

  getApplication(applicationId: number): ApplicationRow | null {
    const row = this.#sql
      .exec<{
        application_id: number;
        email_hash: string;
        deed_id: number;
        deed_file_name: string | null;
        status: string;
        loan_amount: string;
        property_value_usd: string;
        disbursed_wei: string;
        repaid_wei: string;
        created: number;
      }>(`SELECT * FROM application WHERE application_id = ?`, applicationId)
      .toArray()[0];
    if (!row) return null;
    return {
      applicationId: row.application_id,
      emailHash: row.email_hash,
      deedId: row.deed_id,
      deedFileName: row.deed_file_name,
      status: row.status,
      loanAmount: row.loan_amount,
      propertyValueUsd: row.property_value_usd,
      disbursedWei: row.disbursed_wei,
      repaidWei: row.repaid_wei,
      created: row.created,
    };
  }

  listApplications(emailHash: string): ApplicationRow[] {
    return this.#sql
      .exec<{
        application_id: number;
        email_hash: string;
        deed_id: number;
        deed_file_name: string | null;
        status: string;
        loan_amount: string;
        property_value_usd: string;
        disbursed_wei: string;
        repaid_wei: string;
        created: number;
      }>(`SELECT * FROM application WHERE email_hash = ? ORDER BY created DESC`, emailHash)
      .toArray()
      .map((row) => ({
        applicationId: row.application_id,
        emailHash: row.email_hash,
        deedId: row.deed_id,
        deedFileName: row.deed_file_name,
        status: row.status,
        loanAmount: row.loan_amount,
        propertyValueUsd: row.property_value_usd,
        disbursedWei: row.disbursed_wei,
        repaidWei: row.repaid_wei,
        created: row.created,
      }));
  }
}
