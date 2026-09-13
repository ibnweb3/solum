# Solum

**A mortgage that checks, trustlessly, whether your deed is already pledged somewhere else —
before it approves you. No wallet, no gas, no seed phrase for the borrower.**

🔗 **Live app:** [solum.ibnweb3lab.workers.dev](https://solum.ibnweb3lab.workers.dev)
📄 **Protocol whitepaper:** [`docs/attestcoin-integration.md`](docs/attestcoin-integration.md)
🐙 **Source:** this repo · 💬 **Contact:** [@ibnweb3 on X](https://x.com/ibnweb3)

Built for [BUIDL CTC 2026 Fall](https://dorahacks.io/hackathon/buidl-ctc-2026-fall) (Creditcoin
& Credit Labs), RWA track, on the [Attestcoin Protocol](https://docs.attestcoin.org/).

---

## What Solum is

Real-world-asset tokenization is fragmenting across chains and platforms faster than any
registry can track it. Nothing stops the same tokenized property deed from being pledged as
collateral on two unrelated lending platforms — each one only sees its own ledger.
**Double-pledging** is a real, documented mortgage-fraud pattern, not a hypothetical.

Solum solves one specific piece of that: before approving a mortgage against a property deed, it
cryptographically verifies — with no oracle, no partnership, no shared database between
platforms — whether that same deed is already pledged as collateral somewhere else. The proof
comes from the [Attestcoin Protocol](https://docs.attestcoin.org/), which lets a contract on
Creditcoin trustlessly verify that a specific event happened on another chain (in this case,
Ethereum Sepolia).

On top of that, Solum is built so a non-technical borrower can actually use it: sign in with an
email, no wallet or seed phrase ever required.

## Try it

Go to **[solum.ibnweb3lab.workers.dev](https://solum.ibnweb3lab.workers.dev)** — no install, no
wallet, no testnet tokens needed on your end.

1. **Sign in** with any email address. You'll get a real emailed code if you're the account
   owner of the configured mail sender; everyone else gets the code shown directly on screen
   (clearly labeled) — sign-in works either way.
2. **Apply for a mortgage.** Download one of the two sample deed documents, then upload it back
   into the form — the app recognizes which property it is and fills in the rest, or you can
   pick a property manually from the dropdown. One sample deed is already pledged as collateral
   elsewhere; the other is clean.
3. **See the decision.** Approved or declined comes back in plain English, with a link to the
   real on-chain transaction that proves it — no "trust us."
4. **If approved**, your Solum account is credited with testnet funds (illustrative — see the
   FAQ on the site) that you can see and withdraw to any address you hold.
5. **Check any application's status** any time, without signing in — the same lookup an SMS
   status-check would use.

## How it works

```
 Ethereum Sepolia ("Platform A" —          Creditcoin CC3 testnet (Solum)
 unrelated to Solum)
 ┌──────────────────────────┐              ┌───────────────────────────────────┐
 │ PropertyDeed (ERC-721)    │              │ SolumASC (extends ASCBase)         │
 │ PledgeVault.pledge(...)   │              │  execute(...) ─► Block Prover      │
 │   emits CollateralPledged │              │  precompile (0x0FD2) ─► verified   │
 └──────────┬────────────────┘              │  ─► deedIsPledgedElsewhere[deedId] │
            │                               │                                     │
            │ tx hash                       │  applyForMortgage(...) reads that   │
            ▼                               │  verified mirror, approves/rejects, │
 worker/src/cli.ts ── waits for attestation, │  disburses funds on approval        │
 fetches Merkle + continuity proof ─────────►│                                     │
 from the Attestcoin Proof Builder           └──────────────┬──────────────────────┘
                                                              │
                                              backend/ (Cloudflare Worker)
                                              plain-language UI, gasless relayer +
                                              account/withdraw, SMS bridge — all
                                              read/write through SolumASC above
```

A source-chain contract (`PledgeVault`, on Ethereum Sepolia) locks a property deed as collateral
and emits an event. A readability worker waits for that transaction to be cryptographically
attested, fetches a proof, and submits it to `SolumASC` on Creditcoin, which verifies it against
the **Block Prover precompile** before recording the deed as pledged. From then on, any mortgage
application against that deed is checked, instantly and trustlessly, against that verified
record. Full technical detail, design rationale, and security properties are in
[`docs/attestcoin-integration.md`](docs/attestcoin-integration.md).

## Deployed contracts

| Contract | Chain | Address |
|---|---|---|
| `PropertyDeed` | Ethereum Sepolia | [`0xe5c3c28dBDdd3AB3486aBa2c9AE42b2321D659FD`](https://sepolia.etherscan.io/address/0xe5c3c28dBDdd3AB3486aBa2c9AE42b2321D659FD) |
| `PledgeVault` | Ethereum Sepolia | [`0xAc486c6E6632af96C432f97857CA7643911885B0`](https://sepolia.etherscan.io/address/0xAc486c6E6632af96C432f97857CA7643911885B0) |
| `SolumASC` | Creditcoin CC3 testnet | [`0xe5c3c28dBDdd3AB3486aBa2c9AE42b2321D659FD`](https://creditcoin-testnet.blockscout.com/address/0xe5c3c28dBDdd3AB3486aBa2c9AE42b2321D659FD) |

## Repo layout

```
contracts/source-chain/   PropertyDeed + PledgeVault — "Platform A" (Sepolia, Foundry)
contracts/creditcoin/     SolumASC, the mortgage underwriter (Creditcoin CC3, Foundry)
worker/                   Readability worker: proves a Sepolia pledge to SolumASC
backend/                  Cloudflare Worker — API, gasless relayer, account/withdraw, SMS route
sms-bridge/               SMS webhook + status-check handler, imported by backend/
frontend/                 The web app (static, served by backend/)
docs/attestcoin-integration.md   Protocol integration whitepaper
```

## Run it yourself / integrate

**Prerequisites:** [Foundry](https://getfoundry.sh/) (`foundryup --version v1.2.3`), Node.js 20+,
a [Cloudflare account](https://dash.cloudflare.com) with `wrangler` logged in, Sepolia ETH, and
CC3 testnet tCTC (Creditcoin Discord → `#token-faucet` → `/faucet address:<yours>`).

### 1. Deploy the contracts

```bash
# Sepolia — Platform A
cd contracts/source-chain
cp .env.example .env   # fill in SEPOLIA_RPC_URL, DEPLOYER_PK
./deploy.sh

# Creditcoin CC3 — Solum
cd ../creditcoin
cp .env.example .env   # fill in CC3_RPC_URL, DEPLOYER_PK
./deploy.sh <SOURCE_CHAIN_PLEDGE_VAULT_ADDRESS from the step above>
```

Both scripts print (and save to `deployed.env`) the addresses you'll need next.

### 2. Prove a pledge (the readability worker)

```bash
cd worker
npm install
cp .env.example .env   # fill in the RPC URLs, CREDITCOIN_WALLET_PRIVATE_KEY, SOLUM_ASC_CONTRACT_ADDRESS
npm run attest -- --tx <sepoliaPledgeTxHash>
```

This waits for Creditcoin attestation, fetches a Merkle + continuity proof from the Attestcoin
Proof Builder, and submits it on-chain — takes a few minutes.

### 3. Run the app

```bash
cd backend
npm install
cp .dev.vars.example .dev.vars   # fill in SESSION_SECRET + CREDITCOIN_FUNDER_PRIVATE_KEY for local dev
npm run dev                       # local dev server

# For production:
wrangler secret put SESSION_SECRET
wrangler secret put CREDITCOIN_FUNDER_PRIVATE_KEY   # pays gas + disbursements for relayer wallets
wrangler secret put PRIVY_APP_ID       # optional — real embedded wallets, see Known limitations
wrangler secret put PRIVY_APP_SECRET   # optional
npm run deploy
```

Update `SOLUM_ASC_CONTRACT_ADDRESS` in `backend/wrangler.jsonc` to point at your own deployment.

### API reference

All endpoints are relative to the deployed Worker's origin.

| Method | Path | Body / params | Notes |
|---|---|---|---|
| `POST` | `/api/login/start` | `{ email }` | Issues a code; emails it via Resend if configured, else returns `devCode` in the response |
| `POST` | `/api/login/verify` | `{ email, otp }` | Sets a session cookie on success |
| `POST` | `/api/apply` | `{ deedId, propertyValueUsd, loanAmount }` | Session required. Runs the underwriting check, disburses funds on approval |
| `GET` | `/api/status/:applicationId` | — | Public, no session needed |
| `GET` | `/api/my-applications` | — | Session required |
| `GET` | `/api/account` | — | Session required. Returns relayer address + tCTC balance |
| `POST` | `/api/withdraw` | `{ toAddress }` | Session required. Sweeps the balance (minus a gas reserve) to `toAddress` |
| `POST` | `/sms/smsgate` | sms-gate.app webhook payload | `STATUS <id>` → the same plain-English lookup as `/api/status` |

## Known limitations

These are deliberate scope decisions for a testnet hackathon build, not bugs:

- **Gasless relayer wallets are real embedded wallets via [Privy](https://privy.io)'s Server
  Wallets** — Privy generates and holds each key, and the backend only ever asks it to sign, so
  key material is never generated or stored in our own database. That's still app-custodied (the
  backend can request any signature; there's no per-user co-signing requirement), and there's a
  locally-generated key as a fallback if Privy isn't configured — neither is the same as an
  ERC-4337 smart account with a paymaster. Fine for a demo, not for holding real value.
- **Loan amounts and disbursements are illustrative**, not real currency — see the in-app FAQ
  for the exact conversion used.
- **Deed documents are matched by filename**, not real document/OCR verification, and minting a
  deed is a concierge action rather than a real notarization process.
- **Real email delivery only reaches the mail sender's own verified address** until a custom
  domain is verified with the email provider; everyone else gets the on-screen fallback code.
- **The readability worker is a manual CLI**, not a 24/7 watcher — deliberate, for predictable
  demos; the cryptography itself is fully real either way.
- **Attestcoin Writability was not used** — see the whitepaper for why.
