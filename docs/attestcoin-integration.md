# Solum × Attestcoin Protocol — integration summary

## The problem

Real estate tokenization is fragmenting across chains and platforms faster than any registry
can track it. Nothing today stops the same tokenized property deed from being pledged as
collateral for a loan on two unrelated platforms, on two different chains — each platform only
sees its own ledger. This isn't hypothetical: double-pledging is a documented mortgage-fraud
pattern in the real world, and it exists precisely because title/collateral records don't sync
in real time across institutions, let alone across blockchains.

**Amara** tokenizes her rental property on "Platform A" (a generic pawn-shop-style lending
vault we built on Ethereum Sepolia) and gets a loan against it. Weeks later, she — or a
fraudster — applies for a second mortgage against the same deed on Solum, on Creditcoin.
Without a trustless cross-chain check, this succeeds, because nothing connects the two
platforms.

## Why Attestcoin, specifically

Solum needs exactly one primitive: **prove that a specific event happened on another chain,
with no oracle and no partnership between the two platforms.** That is the Attestcoin
Protocol's readability capability, and nothing else in the stack solves it without
reintroducing a trusted third party (a bridge operator, a shared API, a business relationship
between rival lenders who have no reason to cooperate).

## What we built (readability only — see "Why not writability" below)

### Two genuinely separate, non-trusting contract systems

- **`PledgeVault` + `PropertyDeed` (Ethereum Sepolia)** — "Platform A." A standalone,
  ERC-721-based pawn-shop vault. It has zero knowledge of Solum, Creditcoin, or Attestcoin. It
  just locks a deed as collateral and emits one event:
  `CollateralPledged(uint256 indexed deedId, address indexed pledgor, uint256 loanAmount, uint256 timestamp)`.
- **`SolumASC` (Creditcoin CC3 testnet)** — the mortgage underwriter. Before approving a new
  mortgage against a deed, it checks a local mirror that can *only* be updated by a
  cryptographically verified Sepolia transaction — never by a caller's say-so.

### The Attestcoin flow, as actually implemented

1. `PledgeVault.pledge(deedId, loanAmount)` is called on Sepolia; it emits `CollateralPledged`.
2. The **readability worker** (`worker/src/cli.ts`) waits for the transaction to be mined, then
   waits for that Sepolia block to be attested on Creditcoin (`PrecompileChainInfoProvider` /
   the Attestcoin Proof Builder service), then fetches a Merkle inclusion proof + continuity
   proof from the hosted Proof Builder (`https://prover.cc3-testnet.creditcoin.network`).
3. The worker calls `SolumASC.execute(action, chainKey, blockHeight, encodedTransaction,
   merkleRoot, siblings, lowerEndpointDigest, continuityRoots)` — the entry point `SolumASC`
   inherits from `ASCBase` (`@gluwa/asc-contracts`, `contracts/readability/ASCBase.sol`).
4. `ASCBase.execute` calls the **Block Prover precompile at `0x0FD2`**
   (`INativeQueryVerifier.verifyAndEmit`) to verify inclusion, computes a `queryId` from
   `(chainKey, blockHeight, txIndex)`, and rejects any second submission of the same proof
   (`processedQueries[queryId]`) — replay protection is handled entirely by the base contract,
   not by Solum's own code.
5. Only after verification does `SolumASC._processAndEmitEvent` run: it decodes the transaction
   via `EvmV1Decoder`, **explicitly checks the receipt status field (`receiptStatus == 1`)** —
   the precompile only proves a transaction was *included*, not that it *succeeded*, so skipping
   this check is the single easiest correctness bug to introduce — then verifies the log was
   emitted by the one registered `pledgeVault` address (`registerPledgeVault`, admin-only),
   because without that binding anyone could deploy a lookalike contract and grief a clean deed
   into looking pledged elsewhere. Only then does it set
   `deedIsPledgedElsewhere[deedId] = true`.
6. `applyForMortgage(deedId, propertyValueUsd, loanAmount)` makes a **synchronous** decision by
   reading that already-verified mirror. This is deliberate: rather than triggering a live,
   multi-minute cross-chain proof mid-application (real, but unpredictable to demo), the proof
   happens once, ahead of time, and the mortgage decision is instant and rehearsable — while
   remaining fully trustless, since the mirror can only ever be set by a real, proved Sepolia
   transaction.

### Contracts

| Contract | Chain | Address |
|---|---|---|
| `PropertyDeed` | Ethereum Sepolia | see `contracts/source-chain/deployed.env` |
| `PledgeVault` | Ethereum Sepolia | see `contracts/source-chain/deployed.env` |
| `SolumASC` | Creditcoin CC3 testnet | see `contracts/creditcoin/deployed.env` |
| Block Prover precompile | Creditcoin CC3 testnet | `0x0000000000000000000000000000000000000FD2` |
| `EvmV1Decoder` (shared library) | Creditcoin CC3 testnet | `0x04B9ae8562D8Cc5bbbBbBB759080dDC30B56D18B` (pre-deployed, canonical — same address the official `attestcoin-protocol-examples` repo ships) |

### Why not writability

Attestcoin Writability (Creditcoin → other chains) was intentionally not used: as of this
hackathon, it's explicitly still undergoing 3rd-party audit per the protocol's own
documentation. Solum's core claim — "this mortgage check is trustless" — would be undermined
by building on a component the protocol itself flags as not yet production-hardened. Readability
alone is sufficient for the anti-double-pledge check; a future version could use writability to
push a mortgage lien notice *back* to the source chain.

## Disclosed simplifications (hackathon scope, not production claims)

- **Gasless onboarding** is a backend-custodied relayer wallet per user (generated on login,
  funded automatically), explicitly *not* production-grade custody. A real product would use
  ERC-4337 smart accounts with a paymaster.
- **Email login is mocked** — no real email is sent; the OTP is returned directly in the API
  response so the flow is fully testable without an email provider.
- **Deed minting is a concierge action**, not a real title/notarization process — out of scope
  for a hackathon timeline, and disclosed as such.
- **The worker is a manual-trigger CLI**, not a 24/7 watcher, chosen deliberately for demo
  predictability over automation — the cryptography is fully real either way.
