import { ethers } from "ethers";
import type { Env } from "../shared/env.ts";

export interface RelayerAccount {
  address: string;
  balanceWei: bigint;
}

export async function getRelayerAccount(env: Env, hash: string): Promise<RelayerAccount | null> {
  const registry = env.SessionRegistry.get(env.SessionRegistry.idFromName("global"));
  const record = await registry.getRelayer(hash);
  if (!record) return null;

  const provider = new ethers.JsonRpcProvider(env.CREDITCOIN_RPC_URL);
  const balanceWei = await provider.getBalance(record.address);
  return { address: record.address, balanceWei };
}

/**
 * Sends everything above a safe gas reserve to `toAddress` — the "cash out to a wallet you
 * actually hold" step for a borrower who wants to prove the funds are real and move them off
 * the backend-custodied relayer account.
 */
export async function withdrawRelayerFunds(
  env: Env,
  hash: string,
  toAddress: string,
): Promise<{ txHash: string; amountWei: bigint }> {
  if (!ethers.isAddress(toAddress)) throw new Error("invalid_address");

  const registry = env.SessionRegistry.get(env.SessionRegistry.idFromName("global"));
  const record = await registry.getRelayer(hash);
  if (!record) throw new Error("no_account");

  const provider = new ethers.JsonRpcProvider(env.CREDITCOIN_RPC_URL);
  const wallet = new ethers.Wallet(record.privateKey, provider);

  const balance = await provider.getBalance(record.address);
  const feeData = await provider.getFeeData();
  // Prefer the EIP-1559 fee field (what ethers actually uses when no gas overrides are passed);
  // a plain value transfer is always exactly 21000 gas. A generous 3x buffer plus an absolute
  // floor avoids "insufficient funds for gas * price + value" from underestimating the reserve.
  const feePerGas = feeData.maxFeePerGas ?? feeData.gasPrice ?? ethers.parseUnits("5", "gwei");
  const computedReserve = feePerGas * 21_000n * 3n;
  const gasReserve = computedReserve > ethers.parseEther("0.01") ? computedReserve : ethers.parseEther("0.01");
  const amount = balance - gasReserve;
  if (amount <= 0n) throw new Error("insufficient_balance");

  const tx = await wallet.sendTransaction({ to: toAddress, value: amount });
  await tx.wait();
  return { txHash: tx.hash, amountWei: amount };
}
