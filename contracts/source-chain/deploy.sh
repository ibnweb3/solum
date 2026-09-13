#!/usr/bin/env bash
# Deploys "Platform A" (PropertyDeed + PledgeVault) to Ethereum Sepolia and seeds two demo
# deeds: #1 ("Amara's rental", immediately pledged here) and #2 (clean, never pledged).
#
# Requires: contracts/source-chain/.env with SEPOLIA_RPC_URL, DEPLOYER_PK
set -euo pipefail
cd "$(dirname "$0")"
set -a; source .env; set +a
export PATH="$PATH:/c/Users/IBN/.foundry/bin"

DEPLOYER_ADDR=$(cast wallet address --private-key "$DEPLOYER_PK")
echo "Deployer: $DEPLOYER_ADDR"

echo "--- Deploying PropertyDeed ---"
DEED_OUT=$(forge create --broadcast --rpc-url "$SEPOLIA_RPC_URL" --private-key "$DEPLOYER_PK" \
  src/PropertyDeed.sol:PropertyDeed)
echo "$DEED_OUT"
DEED_ADDR=$(echo "$DEED_OUT" | grep "Deployed to:" | awk '{print $3}')
echo "PropertyDeed: $DEED_ADDR"

echo "--- Deploying PledgeVault ---"
VAULT_OUT=$(forge create --broadcast --rpc-url "$SEPOLIA_RPC_URL" --private-key "$DEPLOYER_PK" \
  src/PledgeVault.sol:PledgeVault --constructor-args "$DEED_ADDR")
echo "$VAULT_OUT"
VAULT_ADDR=$(echo "$VAULT_OUT" | grep "Deployed to:" | awk '{print $3}')
echo "PledgeVault: $VAULT_ADDR"

echo "--- Minting demo deed #1 (Amara's rental) to deployer ---"
cast send --rpc-url "$SEPOLIA_RPC_URL" --private-key "$DEPLOYER_PK" \
  "$DEED_ADDR" "mint(address,string)" "$DEPLOYER_ADDR" "ipfs://amara-rental"

echo "--- Minting demo deed #2 (clean deed) to deployer ---"
cast send --rpc-url "$SEPOLIA_RPC_URL" --private-key "$DEPLOYER_PK" \
  "$DEED_ADDR" "mint(address,string)" "$DEPLOYER_ADDR" "ipfs://clean-deed"

echo "--- Approving PledgeVault for deed #1 ---"
cast send --rpc-url "$SEPOLIA_RPC_URL" --private-key "$DEPLOYER_PK" \
  "$DEED_ADDR" "approve(address,uint256)" "$VAULT_ADDR" 1

echo "--- Pledging deed #1 for a 40000 (demo unit) loan on Platform A ---"
PLEDGE_TX=$(cast send --rpc-url "$SEPOLIA_RPC_URL" --private-key "$DEPLOYER_PK" \
  "$VAULT_ADDR" "pledge(uint256,uint256)" 1 40000 --json)
echo "$PLEDGE_TX"
PLEDGE_TX_HASH=$(echo "$PLEDGE_TX" | grep -o '"transactionHash":"[^"]*"' | cut -d'"' -f4)

{
  echo "SOURCE_CHAIN_DEED_ADDRESS=$DEED_ADDR"
  echo "SOURCE_CHAIN_PLEDGE_VAULT_ADDRESS=$VAULT_ADDR"
  echo "DEMO_PLEDGE_TX_HASH=$PLEDGE_TX_HASH"
} | tee deployed.env

echo ""
echo "Done. Deed #1 is now pledged on Platform A (tx: $PLEDGE_TX_HASH) — this is the tx the"
echo "worker will prove to SolumASC. Deed #2 is still clean, for the approval demo path."
echo "Addresses written to contracts/source-chain/deployed.env"
