import { ethers } from "ethers";
import type { Env } from "../shared/env.ts";

/**
 * Illustrative demo conversion only: SolumASC's `loanAmount` is a plain uint256 the borrower
 * typed in (no real currency), so there is nothing "real" to disburse. To make an approval feel
 * tangible rather than just a status flag, we send a small, proportional amount of tCTC to the
 * borrower's relayer wallet — 1 tCTC per 100,000 loan units, capped at 20 tCTC per approval so a
 * demo run can't drain the funder wallet.
 */
export function computeDisbursementWei(loanAmount: number): bigint {
  const capped = Math.min(Math.max(Math.round(loanAmount) || 0, 0), 2_000_000);
  const wei = (BigInt(capped) * 10n ** 18n) / 100_000n;
  const maxWei = 20n * 10n ** 18n;
  return wei > maxWei ? maxWei : wei;
}

export async function disburseLoanFunds(
  env: Env,
  provider: ethers.JsonRpcProvider,
  relayerAddress: string,
  loanAmount: number,
): Promise<{ txHash: string; amountWei: bigint } | null> {
  if (!env.CREDITCOIN_FUNDER_PRIVATE_KEY) return null;
  const amountWei = computeDisbursementWei(loanAmount);
  if (amountWei <= 0n) return null;

  const funder = new ethers.Wallet(env.CREDITCOIN_FUNDER_PRIVATE_KEY, provider);
  const tx = await funder.sendTransaction({ to: relayerAddress, value: amountWei });
  await tx.wait();
  return { txHash: tx.hash, amountWei };
}
