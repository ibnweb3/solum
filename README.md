# Solum

**A mortgage that checks, trustlessly, whether your deed is already pledged somewhere else —
before it approves you. No wallet, no gas, no seed phrase for the borrower.**

Built for [BUIDL CTC 2026 Fall](https://dorahacks.io/hackathon/buidl-ctc-2026-fall) (Creditcoin
& Credit Labs), RWA track. Every submission this season must integrate the
[Attestcoin Protocol](https://docs.attestcoin.org/) — see
[`docs/attestcoin-integration.md`](docs/attestcoin-integration.md) for the full technical
breakdown of how Solum uses it.

## The problem

Real-world-asset tokenization is fragmenting across chains and platforms faster than any
registry can track it. Nothing stops the same tokenized property deed from being pledged as
collateral on two unrelated lending platforms — each one only sees its own ledger. This is a
real, documented mortgage-fraud pattern (double-pledging), not a hypothetical.

**Amara** tokenizes her rental property on "Platform A" (a generic pawn-shop-style vault we
built on Ethereum Sepolia) and gets a loan against it. Weeks later, she — or a fraudster —
applies for a second mortgage against the same deed on Solum, on Creditcoin. Without a
trustless, cross-chain check, this succeeds, because no registry connects the two platforms —
and no centralized alternative works either, since rival lenders have no reason to share a
database or sign a partnership with each other.

## What it does

1. **Cross-chain collateral check.** Before approving a mortgage, Solum verifies — via
   Attestcoin, with no oracle, no partnership between platforms — whether the deed is already
   pledged elsewhere.
2. **Plain-language application.** No wallet address, gas, or NFT jargon shown to the borrower;
   decisions come back in plain English ("declined — already pledged on another platform").
3. **Gasless onboarding.** Sign in with just an email; a backend-custodied relayer wallet is
   created and funded automatically. Disclosed hackathon simplification — see
   `docs/attestcoin-integration.md`.
4. **SMS status-check.** Text `STATUS <application number>` to get the same plain-English
   answer the web app gives, off one shared formatter.

## Architecture

```
 Ethereum Sepolia ("Platform A" —          Creditcoin CC3 testnet (Solum)
 unrelated to Solum)
 ┌──────────────────────────┐              ┌───────────────────────────────────┐
 │ PropertyDeed (ERC-721)    │              │ SolumASC (extends ASCBase)         │
 │ PledgeVault.pledge(...)   │              │  execute(...) ─► Block Prover      │
 │   emits CollateralPledged │              │  precompile (0x0FD2) ─► verified   │
 └──────────┬────────────────┘              │  ─► deedIsPledgedElsewhere[deedId] │
            │                               │                                     │
            │ tx hash                       │  applyForMortgage(deedId, ...)      │
            ▼                               │   reads that verified mirror,       │
 worker/src/cli.ts ── waits for attestation, │   approves or rejects instantly     │
 fetches Merkle + continuity proof ─────────►│                                     │
 from the Attestcoin Proof Builder           └──────────────┬──────────────────────┘
                                                              │
                                              backend/ (Cloudflare Worker)
                                              plain-language UI, gasless relayer,
                                              SMS bridge — all read/write through
                                              the same SolumASC contract above
```

## Repo layout

```
contracts/source-chain/   PropertyDeed + PledgeVault (Sepolia, Foundry)
contracts/creditcoin/     SolumASC (Creditcoin CC3 testnet, Foundry)
worker/                   Readability worker — manual-trigger CLI (see below for why)
backend/                  Cloudflare Worker: plain-language API, gasless relayer, SMS route
sms-bridge/               SMS webhook + status-check handler, shared with backend/
frontend/                 Static apply/status page (served by backend/)
docs/attestcoin-integration.md   Full protocol integration write-up (required deliverable)
```

## Why the worker is a manual CLI, not a 24/7 watcher

A persistent watcher is one more process that can silently stall while judges are watching a
live demo. `worker/src/cli.ts` is run on cue instead — rehearsable, rerunnable if a testnet RPC
hiccups. Only the *when* is manual; the cryptographic proof and on-chain verification are fully
real either way.

## Status

**Done and verified**
- `PropertyDeed.sol` + `PledgeVault.sol` — deployed on Sepolia, tests passing, a real
  `CollateralPledged` pledge transaction on-chain for the demo (deed #1, "Amara's rental").
- `SolumASC.sol` — written against the real `@gluwa/asc-contracts` package (not just docs),
  compiles clean with `via_ir`, source-contract-binding tests passing (rejects a spoofed
  emitter, rejects an unregistered vault).
- `worker/src/cli.ts` — full readability pipeline (wait for mining → wait for attestation →
  fetch proof → submit `execute(...)`), mirroring the official `attestcoin-protocol-examples`
  loan-flow worker.
- `backend/` — plain-language apply/status API, mocked-OTP login, gasless per-user relayer
  wallets, verified end-to-end locally (`wrangler dev`) against the login → apply flow.
- `frontend/index.html` — themed, single-file, no framework; verified rendering and the full
  sign-in → apply flow in-browser.

**Not done yet**
- `SolumASC` deployment to Creditcoin CC3 testnet — blocked on the deployer wallet's tCTC
  faucet claim (Discord `/faucet`); Sepolia side is fully live and waiting on it.
- The live worker run proving the real Sepolia pledge tx to `SolumASC` (needs the above).
- SMS status-check — needs a fresh sms-gate.app device/account (not the same one as a sibling
  project); first thing cut if time runs out.
- Repayment/equity-release lifecycle (`PaymentMade` → `recordPaymentAttestation`) — scoped as
  an optional extension from the start, not required for a complete submission.

## Disclosed simplifications

See `docs/attestcoin-integration.md`'s closing section — gasless relayer custody, mocked email
OTP, and concierge deed minting are all explicitly hackathon-scope simplifications, not
production claims.
