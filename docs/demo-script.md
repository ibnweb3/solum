# Solum demo script

Run through in order; each step produces something to show on screen. Fill in the bracketed
addresses/hashes from `contracts/*/deployed.env` once both chains are deployed.

## 1. The setup (30s)

"Amara tokenizes her rental property and gets a loan against it on Platform A — a lending vault
on Ethereum. Nothing connects Platform A to any other lender. If she — or a fraudster — applies
for a second mortgage against the same deed somewhere else, today, that just works."

## 2. Show the pledge on Sepolia (30s)

- Open `[SOURCE_CHAIN_PLEDGE_VAULT_ADDRESS]` on Sepolia Etherscan.
- Show the `CollateralPledged` event log for deed #1, tx `[DEMO_PLEDGE_TX_HASH]`.
- "That's it — a normal transaction on a normal Ethereum contract. Platform A doesn't know
  Solum or Creditcoin exist."

## 3. Run the worker live (60–90s, mostly waiting)

```bash
cd worker
npm run attest -- --tx [DEMO_PLEDGE_TX_HASH]
```

Narrate while it runs: "This is the actual Attestcoin readability flow — waiting for the block
to be attested on Creditcoin, then fetching a real Merkle and continuity proof from the hosted
Proof Builder. No oracle, no bridge custody." When it prints the Creditcoin tx hash and
`deedIsPledgedElsewhere(1) = true`, that's the proof landing on-chain.

- Open the resulting tx on `creditcoin-testnet.blockscout.com` — show the `execute(...)` call
  and the `PledgeAttested` event.

## 4. Apply as a second lender — declined (30s)

- Open the Solum frontend, sign in with a demo email, pick **Deed #1 — Amara's rental**.
- Submit. Show the plain-English decline: *"Deed #1 is already listed as collateral on another
  platform... we declined this application to protect you and the lender."*
- "No human made that call, and Solum never called Platform A — it read a cryptographic proof."

## 5. Apply against a clean deed — approved (20s)

- Same flow, **Deed #2 — clean deed**. Show the plain-English approval.

## 6. The accessibility angle (20s)

- Point at the whole flow: "At no point did the borrower see a wallet address, hold testnet
  gas, or manage a seed phrase. That's deliberate — a real mortgage applicant isn't a crypto
  user, and every other cross-chain lending demo in this hackathon assumes they are."
- If SMS shipped: text `STATUS 1` and `STATUS 2` live, show the replies.

## 7. Close (15s)

"Solum isn't a generic collateral registry — several teams built that. It's a named, concrete
mortgage-fraud problem, solved with the one Attestcoin primitive that actually solves it, wrapped
so a non-technical borrower can use it."

## Recording checklist

- [ ] Terminal font large enough to read on video
- [ ] Sepolia + Creditcoin explorer tabs pre-opened
- [ ] Frontend already logged out (to show the sign-in step, not skip it)
- [ ] Two demo emails ready (one for "approved," one for "declined") if doing them back to back
- [ ] Total runtime under whatever the DoraHacks form's video length limit is — confirm this early
