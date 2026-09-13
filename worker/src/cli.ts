/**
 * Solum readability worker — manual-trigger CLI (not a persistent watcher, by design: a demo
 * run on cue is rehearsable and rerunnable if a testnet RPC hiccups; only the "when do we
 * check" trigger is manual, the cryptography underneath is fully real).
 *
 * Usage:
 *   npm run attest -- --tx <sepoliaPledgeTxHash>
 *
 * What it does, step by step (mirrors the official attestcoin-protocol-examples loan-flow
 * worker's `submitLoanProofAfterTx`, adapted to Solum's single PledgeAttested action):
 *   1. Waits for the given Sepolia tx (a PledgeVault.pledge(...) call) to be mined.
 *   2. Waits for that block to be attested on Creditcoin, then fetches a Merkle + continuity
 *      proof from the hosted Attestcoin Proof Builder service.
 *   3. Calls SolumASC.execute(action=PledgeAttested, ...) on Creditcoin CC3 testnet, which
 *      verifies the proof via the Block Prover precompile (0x0FD2) before running Solum's own
 *      business logic (marking the deed as pledged elsewhere).
 */
import 'dotenv/config';
import { Contract, ethers } from 'ethers';
import { proofProvider, chainInfo } from '@gluwa/usc-sdk';
import solumAscAbi from '../contracts/abi/SolumASC.json';

const PLEDGE_ATTESTED_ACTION = 0; // SolumActions.PledgeAttested in SolumASC.sol

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is not configured`);
  }
  return value;
}

function parseArgs(): { txHash: string } {
  const args = process.argv.slice(2);
  const txFlagIndex = args.indexOf('--tx');
  const txHash = txFlagIndex >= 0 ? args[txFlagIndex + 1] : undefined;
  if (!txHash || !txHash.startsWith('0x')) {
    console.error('Usage: npm run attest -- --tx <sepoliaPledgeTxHash>');
    process.exit(1);
  }
  return { txHash };
}

async function computeGasLimit(
  provider: ethers.JsonRpcApiProvider,
  contract: Contract,
  data: string,
  from: string,
  continuityLength: number
): Promise<bigint> {
  try {
    const estimated = await provider.estimateGas({ to: await contract.getAddress(), data, from });
    return (estimated * 135n) / 100n; // +35% buffer
  } catch (error: any) {
    // Gas estimation against the block-prover precompile can fail even when the real call
    // would succeed (pallet-evm does not always propagate revert reasons during estimation).
    console.warn(`Gas estimation failed (${error.shortMessage ?? error.message}), using a calculated fallback.`);
    return BigInt(21_000 + continuityLength * 5_000 + 20_000);
  }
}

async function main() {
  const { txHash } = parseArgs();

  const sourceChainRpcUrl = requireEnv('SOURCE_CHAIN_RPC_URL');
  const creditcoinRpcUrl = requireEnv('CREDITCOIN_RPC_URL');
  const creditcoinPrivateKey = requireEnv('CREDITCOIN_WALLET_PRIVATE_KEY');
  const proofBuilderUrl = requireEnv('PROOF_BUILDER_URL');
  const solumAscAddress = requireEnv('SOLUM_ASC_CONTRACT_ADDRESS');
  const sourceChainKey = Number(requireEnv('SOURCE_CHAIN_KEY'));

  const sourceChainProvider = new ethers.JsonRpcProvider(sourceChainRpcUrl);
  const ccProvider = new ethers.JsonRpcProvider(creditcoinRpcUrl);
  const ccWallet = new ethers.Wallet(creditcoinPrivateKey, ccProvider);
  const asc = new Contract(solumAscAddress, solumAscAbi, ccWallet);

  console.log(`Waiting for transaction ${txHash} to be mined on Sepolia...`);
  const receipt = await sourceChainProvider.waitForTransaction(txHash, 1, 120_000);
  if (!receipt || receipt.blockNumber == null) {
    throw new Error(`Transaction ${txHash} is not yet mined on the source chain`);
  }
  const blockNumber = receipt.blockNumber;
  console.log(`Transaction ${txHash} found in block ${blockNumber}`);

  const proofBuilder = new proofProvider.service.ProofBuilder(sourceChainKey, proofBuilderUrl);
  const chainInfoProvider = new chainInfo.PrecompileChainInfoProvider(ccProvider);

  const latestAttested = await chainInfoProvider.getLatestAttestedHeightAndHash(sourceChainKey);
  console.log(`Latest attested height for chain key ${sourceChainKey}: ${latestAttested.height}`);
  console.log(`Waiting for block ${blockNumber} attestation on Creditcoin (this can take several minutes)...`);

  // 15s poll interval, 20 minute timeout — matches the reference examples' own conservative default.
  await proofBuilder.waitUntilHeightAttested(sourceChainKey, blockNumber, 15_000, 1_200_000);
  console.log(`Block ${blockNumber} attested! Generating proof...`);

  const proofResult = await proofBuilder.getProof(txHash);
  if (!proofResult.success || !proofResult.data) {
    throw new Error(`Failed to generate proof: ${proofResult.error}`);
  }
  const proof = proofResult.data;
  console.log('Proof generation successful!');

  const params = [
    PLEDGE_ATTESTED_ACTION,
    proof.chainKey,
    proof.headerNumber,
    proof.txBytes,
    proof.merkleProof.root,
    proof.merkleProof.siblings,
    proof.continuityProof.lowerEndpointDigest,
    proof.continuityProof.roots,
  ] as const;

  const data = asc.interface.encodeFunctionData('execute', params);
  const gasLimit = await computeGasLimit(
    ccProvider,
    asc,
    data,
    ccWallet.address,
    proof.continuityProof.roots?.length || 1
  );

  console.log('Submitting proof to SolumASC.execute(...) on Creditcoin CC3 testnet...');
  const tx = await asc.execute(...params, { gasLimit });
  console.log(`Submitted, tx hash: ${tx.hash}`);
  const ccReceipt = await tx.wait();
  console.log(`Confirmed on Creditcoin, block ${ccReceipt.blockNumber}`);

  const pledgeEvent = ccReceipt.logs
    .map((log: any) => {
      try {
        return asc.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((parsed: any) => parsed?.name === 'PledgeAttested');

  if (pledgeEvent) {
    const [deedId, pledgor, loanAmount, queryId] = pledgeEvent.args;
    console.log(`PledgeAttested: deedId=${deedId} pledgor=${pledgor} loanAmount=${loanAmount} queryId=${queryId}`);
    const isPledged = await asc.deedIsPledgedElsewhere(deedId);
    console.log(`SolumASC.deedIsPledgedElsewhere(${deedId}) = ${isPledged}`);
  } else {
    console.warn('Transaction confirmed but no PledgeAttested event found in logs.');
  }

  sourceChainProvider.destroy();
  ccProvider.destroy();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
