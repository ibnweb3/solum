import { ethers } from "ethers";
import type { Env } from "../shared/env.ts";

export interface RepayResult {
  txHash: string;
  amountWei: bigint;
  repaidWei: bigint;
  disbursedWei: bigint;
  fullyRepaid: boolean;
}

/**
 * Repays as much of the illustrative disbursement as the account can afford (after a gas
 * reserve), up to the remaining balance owed. Sends back to the funder wallet — the same
 * account that disbursed the loan (see relayer/disburse.ts) — since this is bookkeeping over
 * native tCTC, not a real loan ledger on SolumASC itself.
 */
export async function repayLoan(env: Env, hash: string, applicationId: number): Promise<RepayResult> {
  if (!env.CREDITCOIN_FUNDER_PRIVATE_KEY) throw new Error("repayment_not_configured");

  const registry = env.SessionRegistry.get(env.SessionRegistry.idFromName("global"));
  const relayer = await registry.getRelayer(hash);
  if (!relayer) throw new Error("no_account");

  const app = await registry.getApplication(applicationId);
  if (!app || app.emailHash !== hash) throw new Error("not_your_loan");
  if (app.status !== "Approved") throw new Error("not_repayable");

  const disbursed = BigInt(app.disbursedWei || "0");
  const alreadyRepaid = BigInt(app.repaidWei || "0");
  const owed = disbursed - alreadyRepaid;
  if (owed <= 0n) throw new Error("already_repaid");

  const provider = new ethers.JsonRpcProvider(env.CREDITCOIN_RPC_URL);
  const wallet = new ethers.Wallet(relayer.privateKey, provider);
  const balance = await provider.getBalance(relayer.address);

  const feeData = await provider.getFeeData();
  const feePerGas = feeData.maxFeePerGas ?? feeData.gasPrice ?? ethers.parseUnits("5", "gwei");
  const computedReserve = feePerGas * 21_000n * 3n;
  const gasReserve = computedReserve > ethers.parseEther("0.01") ? computedReserve : ethers.parseEther("0.01");
  const affordable = balance - gasReserve;
  const amount = owed < affordable ? owed : affordable;
  if (amount <= 0n) throw new Error("insufficient_balance");

  const funderAddress = new ethers.Wallet(env.CREDITCOIN_FUNDER_PRIVATE_KEY).address;
  const tx = await wallet.sendTransaction({ to: funderAddress, value: amount });
  await tx.wait();

  const repaidWei = alreadyRepaid + amount;
  await registry.recordRepayment(applicationId, repaidWei.toString());

  return { txHash: tx.hash, amountWei: amount, repaidWei, disbursedWei: disbursed, fullyRepaid: repaidWei >= disbursed };
}
