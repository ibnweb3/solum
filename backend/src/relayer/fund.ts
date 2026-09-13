import { ethers } from "ethers";
import type { Env } from "../shared/env.ts";

/**
 * Tops up a relayer wallet with tCTC from the pre-funded "funder" wallet, if its balance is
 * running low. This is the entire "gasless" trick for the demo: the borrower's relayer wallet
 * always has enough gas without them ever holding, buying, or even seeing tCTC.
 */
export async function fundRelayerIfNeeded(
  env: Env,
  provider: ethers.JsonRpcProvider,
  relayerAddress: string,
): Promise<void> {
  const topUpWei = BigInt(env.RELAYER_TOPUP_WEI || "5000000000000000");
  const balance = await provider.getBalance(relayerAddress);
  if (balance >= topUpWei / 2n) return;

  if (!env.CREDITCOIN_FUNDER_PRIVATE_KEY) {
    console.warn("[solum] CREDITCOIN_FUNDER_PRIVATE_KEY unset — cannot top up relayer wallet");
    return;
  }

  const funder = new ethers.Wallet(env.CREDITCOIN_FUNDER_PRIVATE_KEY, provider);
  const tx = await funder.sendTransaction({ to: relayerAddress, value: topUpWei });
  await tx.wait();
}
