import { ethers } from "ethers";
import type { Env } from "../shared/env.ts";
import { fundRelayerIfNeeded } from "./fund.ts";

/**
 * The gasless-onboarding core: every logged-in user gets a backend-custodied relayer wallet,
 * generated on first use and funded automatically. The frontend never sees a private key, a
 * wallet address, or a gas prompt. Demo-only custody — see docs/attestcoin-integration.md.
 */
export async function getOrCreateRelayerWallet(env: Env, hash: string): Promise<ethers.Wallet> {
  const registry = env.SessionRegistry.get(env.SessionRegistry.idFromName("global"));
  const provider = new ethers.JsonRpcProvider(env.CREDITCOIN_RPC_URL);

  const existing = await registry.getRelayer(hash);
  let address: string;
  let privateKey: string;
  if (existing) {
    address = existing.address;
    privateKey = existing.privateKey;
  } else {
    const fresh = ethers.Wallet.createRandom();
    await registry.createRelayer(hash, fresh.address, fresh.privateKey);
    address = fresh.address;
    privateKey = fresh.privateKey;
  }

  await fundRelayerIfNeeded(env, provider, address);
  return new ethers.Wallet(privateKey, provider);
}
