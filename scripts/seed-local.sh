#!/usr/bin/env bash
# Seeds a fresh `anvil` with the testnet deploy plus demo state:
# the real collection rarity map, three locks ~3.4 days in, one fresh lock at Level 2.
set -euo pipefail
F="${FOUNDRY_BIN:-$HOME/.foundry/bin}"
CAST="$F/cast"; [ -x "$CAST" ] || CAST="$F/cast.exe"
FORGE="$F/forge"; [ -x "$FORGE" ] || FORGE="$F/forge.exe"
RPC=http://127.0.0.1:8545
PK=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
ME=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266

cd "$(dirname "$0")/../contracts"
"$FORGE" script script/DeployTestnet.s.sol --rpc-url $RPC --broadcast --private-key $PK >/dev/null
J=deployments/31337.json
get() { grep -o "\"$1\": *\"0x[0-9a-fA-F]*\"" $J | grep -o '0x[0-9a-fA-F]*'; }
S=$(get locking); N=$(get nft); T=$(get token)
send() { "$CAST" send --rpc-url $RPC --private-key $PK "$@" >/dev/null; }

# deployer holds (real rarity map): Legendary 1,2 · Epic 36 · Rare 21 · Uncommon 24 · Common 22,23
send $N "setApprovalForAll(address,bool)" $S true
send $T "approve(address,uint256)" $S 1000000000000000000000000
send $S "lock(uint256[],uint256[],uint8[])" "[1,36,22]" "[80000000000000000000,30000000000000000000,8000000000000000000]" "[0,0,0]"
"$CAST" rpc --rpc-url $RPC evm_increaseTime 293760 >/dev/null
"$CAST" rpc --rpc-url $RPC evm_mine >/dev/null
send $S "lock(uint256[],uint256[],uint8[])" "[21]" "[35000000000000000000]" "[1]"
echo "Seeded. Addresses in contracts/$J"
cat $J
