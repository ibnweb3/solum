import { Contract, ethers } from "ethers";
import solumAscAbi from "../../contracts/abi/SolumASC.json" with { type: "json" };
import type { Env } from "../shared/env.ts";
import type { RelayerWallet } from "./wallet.ts";

export interface ApplyResult {
  applicationId: number;
  deedId: number;
  status: "Approved" | "Rejected";
  txHash: string;
}

/** Submits applyForMortgage(...) on behalf of the user's relayer wallet and decodes the result. */
export async function submitMortgageApplication(
  env: Env,
  relayerWallet: RelayerWallet,
  deedId: number,
  propertyValueUsd: number,
  loanAmount: number,
): Promise<ApplyResult> {
  const asc = new Contract(env.SOLUM_ASC_CONTRACT_ADDRESS, solumAscAbi, relayerWallet);

  const tx = await asc.applyForMortgage(deedId, propertyValueUsd, loanAmount);
  const receipt = await tx.wait();

  const decision = receipt.logs
    .map((log: ethers.Log) => {
      try {
        return asc.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((parsed: ethers.LogDescription | null) => parsed?.name === "MortgageApproved" || parsed?.name === "MortgageRejected");

  if (!decision) {
    throw new Error("Application submitted but no MortgageApproved/MortgageRejected event was found");
  }

  return {
    applicationId: Number(decision.args[0]),
    deedId,
    status: decision.name === "MortgageApproved" ? "Approved" : "Rejected",
    txHash: receipt.hash as string,
  };
}
