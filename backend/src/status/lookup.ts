import { Contract, ethers } from "ethers";
import solumAscAbi from "../../contracts/abi/SolumASC.json" with { type: "json" };
import type { Env } from "../shared/env.ts";

const STATUS_NAMES = ["None", "Approved", "Rejected"] as const;

export interface StatusView {
  applicationId: number;
  found: boolean;
  plainEnglish: string;
  raw?: {
    deedId: number;
    propertyValueUsd: string;
    loanAmount: string;
    status: string;
    amountRepaid: string;
  };
}

/**
 * The one plain-English formatter shared by the web API (/api/status/:id) and the SMS bridge
 * (sms-bridge/statusHandler.ts) — one place decides how a mortgage decision reads to a
 * non-technical person, so the web and SMS answers can never drift apart.
 */
export async function lookupApplicationStatus(env: Env, applicationId: number): Promise<StatusView> {
  const provider = new ethers.JsonRpcProvider(env.CREDITCOIN_RPC_URL);
  const asc = new Contract(env.SOLUM_ASC_CONTRACT_ADDRESS, solumAscAbi, provider);

  const app = await asc.getApplication(applicationId);
  const status = STATUS_NAMES[Number(app.status)] ?? "None";

  if (status === "None") {
    return {
      applicationId,
      found: false,
      plainEnglish: `We couldn't find an application numbered ${applicationId}.`,
    };
  }

  let plainEnglish: string;
  if (status === "Approved") {
    plainEnglish =
      `Application #${applicationId}: approved. Your loan of ${app.loanAmount} against deed #${app.deedId} ` +
      `was verified clean — no conflicting collateral was found on any other platform.`;
  } else {
    const [pledgor, conflictingAmount] = await Promise.all([
      asc.pledgorOfDeed(app.deedId),
      asc.pledgedLoanAmount(app.deedId),
    ]);
    plainEnglish =
      `Application #${applicationId}: declined. Deed #${app.deedId} is already listed as collateral on ` +
      `another platform (a loan of ${conflictingAmount} by ${pledgor}) — we declined this application to ` +
      `protect you and the lender.`;
  }

  return {
    applicationId,
    found: true,
    plainEnglish,
    raw: {
      deedId: Number(app.deedId),
      propertyValueUsd: app.propertyValueUsd.toString(),
      loanAmount: app.loanAmount.toString(),
      status,
      amountRepaid: app.amountRepaid.toString(),
    },
  };
}
