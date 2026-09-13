import { ethers } from "ethers";
import type { Env } from "../shared/env.ts";
import { fundRelayerIfNeeded } from "./fund.ts";
import { createPrivyWallet, PrivyRelayerSigner } from "./privySigner.ts";

/** Either a real Privy-custodied embedded wallet or the locally-generated fallback key. */
export type RelayerWallet = ethers.Wallet | PrivyRelayerSigner;

export interface RelayerRecord {
  address: string;
  privateKey: string;
  walletId: string | null;
}

/**
 * The gasless-onboarding core: every logged-in user gets a backend-custodied relayer wallet,
 * generated on first use and funded automatically. The frontend never sees a private key, a
 * wallet address, or a gas prompt.
 *
 * The wallet is a real Privy embedded server wallet when PRIVY_APP_ID/PRIVY_APP_SECRET are
 * configured — Privy generates and holds the key, we only ever ask it to sign (see
 * relayer/privySigner.ts). If Privy is unset or unreachable, this falls back to a
 * locally-generated key so onboarding never breaks; that fallback is the only "we hold the key
 * ourselves" case left, and it's disclosed in docs/attestcoin-integration.md.
 *
 * (We first tried Web3Auth's Node SDK for this. It cannot run on Cloudflare Workers at all —
 * its `@web3auth/auth` dependency calls crypto.getRandomValues() at module-import time as part of
 * a MiMC-sponge key derivation, which Workers' isolate model forbids outside a request handler,
 * so the Worker fails to boot the instant the package is imported. That's why this uses Privy's
 * plain REST API instead of an npm SDK.)
 */
export async function getOrCreateRelayerWallet(env: Env, hash: string): Promise<RelayerWallet> {
  const registry = env.SessionRegistry.get(env.SessionRegistry.idFromName("global"));
  const provider = new ethers.JsonRpcProvider(env.CREDITCOIN_RPC_URL);

  const existing = await registry.getRelayer(hash);
  const record: RelayerRecord = existing ?? (await createRelayerRecord(env));
  if (!existing) {
    await registry.createRelayer(hash, record.address, record.privateKey, record.walletId);
  }

  await fundRelayerIfNeeded(env, provider, record.address);
  return relayerSignerFromRecord(env, provider, record);
}

async function createRelayerRecord(env: Env): Promise<RelayerRecord> {
  try {
    const privy = await createPrivyWallet(env);
    if (privy) return { address: privy.address, privateKey: "", walletId: privy.walletId };
  } catch (err) {
    console.error(`[solum] Privy wallet creation failed, falling back to a locally-generated key: ${(err as Error).stack ?? err}`);
  }
  const fresh = ethers.Wallet.createRandom();
  return { address: fresh.address, privateKey: fresh.privateKey, walletId: null };
}

/** Rebuilds the right kind of signer for an already-created relayer record. */
export function relayerSignerFromRecord(env: Env, provider: ethers.Provider, record: RelayerRecord): RelayerWallet {
  if (record.walletId) return new PrivyRelayerSigner(env, record.walletId, record.address, provider);
  return new ethers.Wallet(record.privateKey, provider);
}
