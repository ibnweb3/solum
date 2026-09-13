# Solum: Trustless Cross-Chain Mortgage Underwriting on the Attestcoin Protocol

**A technical whitepaper on Solum's integration with Creditcoin's Attestcoin Protocol**
Prepared for BUIDL CTC 2026 Fall (Creditcoin & Credit Labs) · RWA track
Live app: [solum.ibnweb3lab.workers.dev](https://solum.ibnweb3lab.workers.dev) · Source: this repository

## Abstract

Tokenized real-world property is increasingly financed across multiple, mutually unaware
platforms and chains. No existing mechanism prevents the same tokenized deed from being pledged
as collateral more than once, because each lending platform is a closed ledger with no view into
any other. Solum is a mortgage-underwriting protocol that closes this gap using the Attestcoin
Protocol's cross-chain readability primitive: before issuing a mortgage against a property deed,
Solum cryptographically verifies — with no oracle, no bridge, and no cooperation agreement
between platforms — whether that deed has already been pledged as collateral on an independent
platform on another chain. This paper describes the problem, the protocol integration that
solves it, the design decisions and their rationale, the security properties of the
implementation, and its current limitations.

## 1. Introduction

### 1.1 The problem: double-pledged collateral

Double-pledging — using the same collateral to secure more than one loan — is a well-documented
form of mortgage and lending fraud. It persists in traditional finance because title and lien
registries are siloed by jurisdiction and institution; it is *structurally worse* in the
emerging market for tokenized real-world assets, where the same physical property can be
represented by independently minted tokens on multiple chains, each recognized by a different,
unrelated lending platform.

Consider a concrete case: a borrower, Amara, tokenizes a rental property on "Platform A," an
Ethereum-based lending vault, and pledges it as collateral for a loan. Weeks later, she — or
someone acting fraudulently — applies for a second mortgage against the same underlying property
on an unrelated platform, on a different chain. Absent a shared registry, the second platform has
no way to know the collateral is already encumbered, and the application succeeds.

### 1.2 Why centralized solutions fail

The obvious centralized fix — a shared database or API between lending platforms — does not
happen in practice, and there is no reason to expect it will: competing lenders have no
commercial incentive to share risk data with each other, and even where willing, a bilateral data
-sharing agreement does not scale to an open market of platforms that do not know one another
exist. What is needed is a way for one platform to verify a fact about another platform's state
*without* a relationship, a shared database, or a trusted intermediary between them.

### 1.3 Why Attestcoin

This is precisely the primitive the [Attestcoin Protocol](https://docs.attestcoin.org/) provides.
Attestcoin is a decentralized cross-chain attestation hub built into Creditcoin: a network of
Attestors reaches consensus on the state of external ("source") chains, and a Creditcoin smart
contract can synchronously verify — via a native precompile, with a cryptographic Merkle and
continuity proof — that a specific transaction occurred on a specific source chain, without
trusting any single party's claim about it. This is exactly the capability Solum needs: a
mortgage underwriter on Creditcoin that can trustlessly know what happened on an entirely
unrelated platform on Ethereum.

## 2. System design

### 2.1 Two independent, non-trusting systems

Solum's design deliberately splits into two contract systems that share no code, no database, and
no operational relationship — because that separation is the point being demonstrated:

- **"Platform A" — `PropertyDeed` + `PledgeVault`, on Ethereum Sepolia.** A minimal,
  standalone, ERC-721-based lending vault. It has no awareness of Solum, Creditcoin, or the
  Attestcoin Protocol; it exists purely to represent an independent lender that locks a
  tokenized deed as collateral and emits an event when it does:
  `CollateralPledged(uint256 indexed deedId, address indexed pledgor, uint256 loanAmount, uint256 timestamp)`.
- **`SolumASC`, on Creditcoin CC3 testnet.** The mortgage underwriter. Before approving a
  mortgage against a given deed, it consults a local record that can be updated *only* by a
  cryptographically verified transaction from the source chain — never by any caller's
  assertion.

### 2.2 The readability flow

The end-to-end flow, as implemented:

1. `PledgeVault.pledge(deedId, loanAmount)` is invoked on Sepolia and emits `CollateralPledged`.
2. An off-chain **readability worker** (`worker/src/cli.ts`) observes the transaction, waits for
   the containing Sepolia block to be attested by the Attestcoin Attestor network on Creditcoin,
   and requests a Merkle inclusion proof plus a continuity proof from the Attestcoin Proof
   Builder service.
3. The worker submits the proof to `SolumASC.execute(action, chainKey, blockHeight,
   encodedTransaction, merkleRoot, siblings, lowerEndpointDigest, continuityRoots)` — the
   entry point inherited from `ASCBase` (`@gluwa/asc-contracts`,
   `contracts/readability/ASCBase.sol`), the reference base contract for readability-only
   Attestcoin Smart Contracts (ASCs).
4. `ASCBase.execute` calls the **Block Prover precompile at address `0x0FD2`**
   (`INativeQueryVerifier.verifyAndEmit`), which synchronously verifies the Merkle and
   continuity proofs against on-chain attestation state. It computes a `queryId` from
   `(chainKey, blockHeight, txIndex)` and enforces that the same proof cannot be submitted twice
   (`processedQueries[queryId]`). This replay protection is provided entirely by the base
   contract; Solum's own logic never re-implements it.
5. Only once the precompile has verified inclusion does `SolumASC._processAndEmitEvent` run its
   own validation: it decodes the transaction with `EvmV1Decoder`, and — because the precompile
   proves only that a transaction was *included* in a block, not that it *succeeded* — explicitly
   checks the receipt's status field (`receiptStatus == 1`) before trusting its contents. It then
   verifies that the emitting contract matches the one registered address, `pledgeVault`
   (set once via the admin-only `registerPledgeVault`); without this binding, any party could
   deploy a contract emitting a lookalike event for an arbitrary `deedId` and falsely mark an
   uninvolved deed as pledged elsewhere. Only after both checks pass does the contract set
   `deedIsPledgedElsewhere[deedId] = true`.
6. `applyForMortgage(deedId, propertyValueUsd, loanAmount)` then makes a synchronous decision
   against this already-verified record.

### 2.3 Design rationale: pre-attestation over live per-application proofs

An alternative design would trigger a fresh cross-chain proof at the moment of each mortgage
application. Solum instead pre-attests known pledges ahead of time and has `applyForMortgage`
read the resulting record synchronously. This is a deliberate choice, not a simplification of the
trust model: the record can only ever be set by a successfully verified Attestcoin proof, so the
result is exactly as trustless as an inline proof would be — the difference is operational, not
cryptographic. A live proof-per-application would make each underwriting decision take as long as
cross-chain attestation itself (minutes), which is both a poor user experience and, for a public
demonstration, non-deterministic in timing. Separating "when a pledge gets proven" from "when an
application is decided" makes the system's trustless core independently verifiable and its
user-facing behavior fast and predictable.

### 2.4 Deployed contracts

| Contract | Chain | Address |
|---|---|---|
| `PropertyDeed` | Ethereum Sepolia | `0xe5c3c28dBDdd3AB3486aBa2c9AE42b2321D659FD` |
| `PledgeVault` | Ethereum Sepolia | `0xAc486c6E6632af96C432f97857CA7643911885B0` |
| `SolumASC` | Creditcoin CC3 testnet | `0xe5c3c28dBDdd3AB3486aBa2c9AE42b2321D659FD` |
| Block Prover precompile | Creditcoin CC3 testnet | `0x0000000000000000000000000000000000000FD2` |
| `EvmV1Decoder` (shared library) | Creditcoin CC3 testnet | `0x04B9ae8562D8Cc5bbbBbBB759080dDC30B56D18B` (pre-deployed canonical instance, shared across Attestcoin applications on this network) |

## 3. Why not Writability

The Attestcoin Protocol also offers Writability — the ability for Creditcoin to send verified
messages to other chains. Solum does not use it. As of this submission, Writability is explicitly
documented as undergoing third-party audit and not yet production-hardened. Solum's central claim
is that its underwriting check is trustless end to end; building that claim on a component the
protocol itself has not yet certified would undermine it. Readability alone is sufficient to solve
the double-pledging problem this system addresses. A natural extension — pushing a lien notice
back to the source chain once Writability is audited — is discussed in Section 6.

## 4. Accessibility as a design goal

A cross-chain collateral check is only as useful as the population that can act on it. Existing
approaches to this class of problem generally assume a crypto-native user: a wallet, held gas,
comfort with signing transactions. A mortgage applicant is, in the overwhelming majority of
cases, not that user. Solum treats accessibility as part of the protocol integration, not a
cosmetic layer on top of it:

- **Plain-language decisions.** Every outcome is rendered in ordinary language — what was
  checked, what was found, and why — rather than a transaction hash and a status enum.
- **Gasless onboarding.** A borrower signs in with an email; a session-scoped relayer account is
  created and funded automatically, so no wallet, seed phrase, or held gas token is ever required
  to interact with the underlying contracts. This is disclosed as a hackathon-scope simplification
  (Section 5) rather than a production custody model.
- **Tangible collateral documents.** Property deeds are represented as downloadable documents a
  user can hold, inspect, and re-submit, rather than only an opaque token ID.
- **An account a borrower can see and leave.** On approval, funds are visibly credited to the
  borrower's account and can be withdrawn to any address they control — the loan is not merely a
  status flag in a database.

## 5. Disclosed limitations (hackathon scope, not production claims)

- **Relayer custody.** Gasless-onboarding wallets are held by the backend, not by ERC-4337 smart
  accounts with a paymaster. Adequate for demonstrating the underwriting flow; not a custody
  model suitable for real funds.
- **Illustrative disbursement.** `SolumASC`'s `loanAmount` is an arbitrary figure entered by the
  applicant, not a real-currency value; the tCTC credited on approval is a proportional,
  disclosed demo conversion, not a real loan disbursement.
- **Deed matching by filename, not document verification.** Sample deed documents are matched
  by filename rather than parsed or notarized; deed minting itself is a concierge action, not a
  real title-registry process.
- **Manual-trigger readability worker.** The worker that submits proofs to `SolumASC` is run on
  demand rather than as a continuously running watcher. This affects only *when* a pledge gets
  proven, not the integrity of the proof itself.
- **Email delivery scope.** Real email delivery via the configured provider currently reaches
  only the provider account's own verified address; other recipients receive the disclosed
  on-screen fallback code until a sending domain is verified.

## 6. Future work

- **Writability-based lien notice.** Once Attestcoin Writability completes audit, `SolumASC`
  could push a lien notice back to the source chain, so Platform A itself becomes aware its
  collateral has been referenced elsewhere — moving from one-way detection to mutual disclosure.
- **Repayment and equity release.** A `PaymentMade` event on the source chain, proven the same
  way as `CollateralPledged`, could progressively release a borrower's equity or the underlying
  deed as a mortgage is repaid.
- **ERC-4337 account abstraction.** Replacing backend-custodied relayer wallets with smart
  accounts and a paymaster would remove the one part of the system that currently requires
  trusting Solum's backend, without reintroducing a seed phrase for the end user.
- **Generalized registry.** The pledge-verification pattern described here is not specific to
  Amara's scenario; any platform that emits a structurally similar collateral event could be
  checked by any other platform adopting the same pattern, without either needing to know the
  other exists in advance.

## 7. Conclusion

Solum demonstrates that the Attestcoin Protocol's readability primitive is sufficient, on its
own, to solve a real and growing failure mode in cross-chain real-world-asset finance:
undetectable double-pledging of collateral across platforms with no incentive to cooperate. The
same design that makes this trustless — verification via cryptographic proof rather than shared
infrastructure — also makes it generalizable to any two platforms that adopt the same pattern,
without requiring them to know of each other's existence.

## References

- Attestcoin Protocol documentation: <https://docs.attestcoin.org/>
- Attestcoin Protocol examples repository: <https://github.com/gluwa/attestcoin-protocol-examples>
- Creditcoin: <https://creditcoin.org/>
- BUIDL CTC 2026 Fall: <https://dorahacks.io/hackathon/buidl-ctc-2026-fall>
