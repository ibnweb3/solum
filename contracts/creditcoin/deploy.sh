#!/usr/bin/env bash
# Deploys SolumASC to Creditcoin CC3 testnet, linking the pre-deployed, canonical
# EvmV1Decoder library (same one the official attestcoin-protocol-examples repo ships in
# bridge/.env.example — one decoder per Creditcoin network, not per-app).
#
# Requires: contracts/creditcoin/.env with CC3_RPC_URL, DEPLOYER_PK, EVM_V1_DECODER_LIBRARY_ADDRESS
set -euo pipefail
cd "$(dirname "$0")"
set -a; source .env; set +a
export PATH="$PATH:/c/Users/IBN/.foundry/bin"

DEPLOYER_ADDR=$(cast wallet address --private-key "$DEPLOYER_PK")
echo "Deployer: $DEPLOYER_ADDR"
echo "Using pre-deployed EvmV1Decoder: $EVM_V1_DECODER_LIBRARY_ADDRESS"

echo "--- Deploying SolumASC ---"
ASC_OUT=$(forge create --broadcast --rpc-url "$CC3_RPC_URL" --private-key "$DEPLOYER_PK" \
  --libraries ../../node_modules/@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol:EvmV1Decoder:"$EVM_V1_DECODER_LIBRARY_ADDRESS" \
  src/SolumASC.sol:SolumASC)
echo "$ASC_OUT"
ASC_ADDR=$(echo "$ASC_OUT" | grep "Deployed to:" | awk '{print $3}')
echo "SolumASC: $ASC_ADDR"

# Requires SOURCE_CHAIN_PLEDGE_VAULT_ADDRESS — set this after running
# contracts/source-chain/deploy.sh (copy the value from its deployed.env), or pass it as $1.
PLEDGE_VAULT_ADDR="${1:-${SOURCE_CHAIN_PLEDGE_VAULT_ADDRESS:-}}"
if [ -z "$PLEDGE_VAULT_ADDR" ]; then
  echo ""
  echo "SolumASC deployed at $ASC_ADDR, but no pledge vault address was provided."
  echo "Run: ./deploy.sh <SOURCE_CHAIN_PLEDGE_VAULT_ADDRESS>  to also register it, or call"
  echo "registerPledgeVault manually once you have the Sepolia PledgeVault address."
else
  echo "--- Registering pledge vault ($PLEDGE_VAULT_ADDR) on SolumASC ---"
  cast send --rpc-url "$CC3_RPC_URL" --private-key "$DEPLOYER_PK" \
    "$ASC_ADDR" "registerPledgeVault(address)" "$PLEDGE_VAULT_ADDR"
fi

echo "SOLUM_ASC_ADDRESS=$ASC_ADDR" | tee deployed.env
echo "Done. Address written to contracts/creditcoin/deployed.env"
