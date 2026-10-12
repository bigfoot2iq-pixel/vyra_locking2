# VYRA Keep: contracts

| Contract | Role |
|---|---|
| `VyraLocking` | Holds locked NFTs, the on-chain rarity map, 5 levels per tier, lock / renew / unlock with a level chosen per lock, and level-ups on running locks. Never holds tokens. |
| `VyraRewardPool` | The single treasury. Holds every locked amount until its lock closes and then **returns it in full**; keeps level fees and deposits as the reward fund that pays daily rewards; only the owner can withdraw, and only the **free fund** (never locked tokens or reserved rewards). |

## Rules

- **Tiers** match the collection's OpenSea **Rarity** trait: `0 Common (545) · 1 Uncommon (327) · 2 Rare (164) · 3 Epic (55) · 4 Legendary (20, ids 1–20)`.
  - Stored as a packed per-token map: 4 bits per guardian, 18 storage words for all 1,111.
  - The data lives in `data/vyra-rarity.json`, built by `node scripts/build-rarity.mjs <metadata-dir>` from the collection metadata (`ipfs://QmZa81…/{id}`).
  - `setRarityWords` uploads it, and `lockRarity()` freezes it forever.
- **Levels:** every tier has one `dailyRateBps` and 5 levels, each with `[minAmount, maxAmount]` and a `price` (the level fee).
  - Level 1 is free (`price = 0`).
  - Caps and fees never go down from one level to the next, and there are no gaps.
  - `maxAmount = 0` closes a level. If Level 1 is closed, the whole tier is closed.
- **Lock:** the holder picks an amount inside their level's range. The contract enforces the range, so nobody can lock more than the owner allows. The amount is held by the pool (`stakedOf`) and **comes back to the holder in full** when the lock closes (unlock, renew or emergency return). Nothing is burned.
- **Choosing a level:** the holder picks the level in `lock(ids, amounts, levels)` / `renew(ids, amounts, levels)`.
  - Level 1 is free. A higher level costs its fee, paid into the pool on top of the locked amount. Fees are not returned; they grow the reward fund.
  - Rewards are earned only on the locked amount, never on the fee.
  - Each lock or renewal picks its level again; nothing is bought before locking.
- **Level up a running lock:** `levelUp(tokenId, newLevel, newAmount)`.
  - Only while the lock is running, and only to a higher level.
  - Pays the fee difference (new level fee − current level fee) plus the top-up (`newAmount` − locked amount) into the pool. The top-up is locked with the rest and returned at unlock.
  - Tribute earned so far is paid out first. The remaining days earn on `newAmount`, and the end date doesn't change.
  - The pool releases the old stake and the reserve for the remaining days, and holds both again at the new amount.
- **Rewards:** `amount × dailyRateBps` per **full 24h since lock start**. Unclaimed days accumulate, and earning stops at the period end.
- **Period:** default 7 days. No early unlock. After the end, call `unlock` (returns the NFT and the locked amount, and pays out the remaining rewards) or `renew` (returns the old amount and remaining rewards, then takes the new payment and starts a new period; the NFT never moves).
- **Snapshots:** every config change applies to new locks only. Running locks keep their snapshot.
- **Switching the token:** the owner can call `setToken` again at any time (e.g. a new token after a sniped launch).
  - Each lock records the token it was paid in (`Lock.token`). Its stake, reserve, claims, settlement and emergency payout stay in that token until it ends.
  - New locks, renewals and level-ups pay in the new token. A lock paid in the old token can't level up (`LockTokenChanged`); it renews into the new token when it ends.
  - The pool keeps stakes, reserves and stats per token (`stakedOf`, `reservedOf`, `returnedOf`, `paidOutOf`, `depositedOf`, `withdrawnOf`; `totalStaked()`, `totalReserved()` etc. show the current token). Seed the new token: rewards in it are paid only from its own fund.
  - The old token's free fund can be recovered with `withdrawSurplusOf(oldToken, to, amount)`.
- **Pause:** `pause()` blocks lock, renew and levelUp. **Claim and unlock always work.**
- **Emergency gate:** the owner can send locked guardians home early with `emergencyReturn(ids)` or `emergencyReturnAll(max)` (batches from the global locked set; repeat until `allLockedCount()` is 0).
  - Each holder gets the locked amount back plus the **full period's** remaining reward (already reserved in the pool), then gets the NFT back.
  - Works while paused. The owner can only send guardians to the holder who locked them, never elsewhere.

## How rewards are funded

Locked tokens are never used to pay anyone's rewards. The pool's balance splits three ways:

- **Staked:** holders' locked amounts, returned when each lock closes.
- **Reserved:** rewards promised to running locks.
- **Free fund:** everything else (the owner's seed, deposits, level fees). New locks reserve their full-period reward out of it, and the owner can withdraw only from it.

A lock whose reward the free fund can't cover reverts instead of over-promising. The owner keeps the fund topped up with `deposit`; level fees refill it as holders lock. The admin page flags tiers whose biggest lock the fund can't back.

## Pool security

- Tokens leave the pool only three ways:
  1. claims, to the lock owner;
  2. closing a lock on unlock/renew/emergency return (rewards + the locked amount), to the lock owner;
  3. `withdrawSurplus` / `withdrawSurplusOf`, by the owner, and only the free fund of each token.
- Locked amounts are staked and rewards reserved when a lock opens. `withdrawSurplus` can never touch either, so even a stolen owner key cannot take holders' tokens or rewards already promised to them.
- The pool ↔ locking wiring is set once. The token can be switched, but reserves are per token, so a switch never frees rewards promised in the old one. `renounceOwnership` is disabled.
- Two-step ownership (`Ownable2Step`). The intended owner is a Safe multisig.
- Reentrancy guards everywhere, and fee-on-transfer tokens are rejected.
- Tests:
  - `forge test` runs the unit/fuzz tests (including the real collection map) plus 4 stateful invariants.
  - The invariants run 256k random locks and renewals at random levels, level-ups, unlocks, claims, emergency returns, owner withdrawals and time jumps and token switches, and every run must include real locks, paid levels and level-ups.
  - They check that the pool always covers every stake plus every reserve, that the locking contract never holds tokens, that the global locked set matches the guardians held, that each token's stake and reserve match its open locks, and that in = out + held for every token.

## Develop

```sh
forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts@v5.4.0 --no-git
forge test
node ../scripts/gen-abis.mjs   # refresh frontend ABIs after changes
```

## Deploy

Local / testnet (mocks, sample tiers and levels, 1,000-token seed): `bash ../scripts/seed-local.sh` against `anvil`, or

```sh
forge script script/DeployTestnet.s.sol --rpc-url ink_sepolia --account <keystore> --broadcast --verify
```

Mainnet (Ink). The script uploads the rarity map from `data/vyra-rarity.json` before handing ownership to the Safe:

```sh
NFT_ADDRESS=0x… FINAL_OWNER=<Safe> \
forge script script/Deploy.s.sol --rpc-url ink --account <keystore> --broadcast --verify
```

Then, from the Safe:
1. `acceptOwnership()` on **both** contracts.
2. `setToken`.
3. `setTierConfigs`.
4. `lockRarity` (the deploy script already uploaded the map; check it on `/admin`, or deploy with `LOCK_RARITY=true`).
5. `deposit` the seed into the pool. Tribute is paid only from this fund, never from locked tokens, so size it for the locks you expect.
6. The VYRA collection owner allow-lists the new locking contract on OpenSea's transfer validator. Until then guardians can't move into the Keep and the site shows "Locking opens soon".

The `/admin` page can copy each call as Safe calldata. Addresses are written to `deployments/<chainId>.json`.

`--verify` publishes the source on the Ink explorer (Blockscout, no API key). To verify a contract deployed without it:

```sh
forge verify-contract <address> src/VyraRewardPool.sol:VyraRewardPool --chain ink --verifier blockscout \
  --verifier-url https://explorer.inkonchain.com/api/ --constructor-args $(cast abi-encode "f(address)" <owner>)
forge verify-contract <address> src/VyraLocking.sol:VyraLocking --chain ink --verifier blockscout \
  --verifier-url https://explorer.inkonchain.com/api/ --constructor-args $(cast abi-encode "f(address,address,address)" <owner> <nft> <pool>)
```

> Not audited. Get an independent audit before mainnet funds.
