# VYRA Keep: contracts

| Contract | Role |
|---|---|
| `VyraLocking` | Holds locked NFTs, the on-chain rarity map, 5 levels per tier, lock / renew / unlock with a level chosen per lock, and level-ups on running locks. Level access belongs to the guardian. Never holds tokens. |
| `VyraRewardPool` | The single treasury. Receives **100%** of lock amounts and level fees plus anyone's deposits, and keeps them; pays each lock its amount back plus the tier's tribute over the **amount locked**; only the owner can withdraw, and only the **unreserved surplus**. |

## Rules

- **Tiers** match the collection's OpenSea **Rarity** trait: `0 Common (545) · 1 Uncommon (327) · 2 Rare (164) · 3 Epic (55) · 4 Legendary (20, ids 1–20)`.
  - Stored as a packed per-token map: 4 bits per guardian, 18 storage words for all 1,111.
  - The data lives in `data/vyra-rarity.json`, built by `node scripts/build-rarity.mjs <metadata-dir>` from the collection metadata (`ipfs://QmZa81…/{id}`).
  - `setRarityWords` uploads it, and `lockRarity()` freezes it forever.
- **Levels:** every tier has one `rateBps` (its tribute, earned once over the whole lock period) and 5 levels, each with a `maxAmount` (the cap) and a `price` (the level fee).
  - Level 1 is free (`price = 0`).
  - Caps and fees never go down from one level to the next, and there are no gaps.
  - `maxAmount = 0` closes a level. If Level 1 is closed, the whole tier is closed.
- **Lock:** the holder picks an amount from 1 up to their level's cap. The contract enforces the cap, so nobody can pay in more than the owner allows. The amount goes to the pool and comes back with the rewards; the level fee goes to the pool and **stays there**. Nothing is burned.
- **Choosing a level:** the holder picks the level in `lock(ids, amounts, levels)` / `renew(ids, amounts, levels)`.
  - Level 1 is free. A higher level costs its fee, paid into the pool on top of the amount.
  - Rewards are earned on the **amount locked**; the fee earns nothing.
  - **Level access belongs to the guardian, not to a lock.** The fee buys the level for that NFT (`accessOf(tokenId)`): it stays unlocked after the lock ends, through every renewal, and after the guardian is sold on. Locking at a level the guardian already owns is free.
- **Level up a running lock:** `levelUp(tokenId, newLevel, newAmount)`.
  - Only while the lock is running, and only to a higher level.
  - Pays the fee still due (nothing when the guardian already owns that level) plus the top-up (`newAmount` − current amount) into the pool.
  - Tribute earned so far is paid out first. The top-up earns the period's `rateBps` pro-rata for the days it is actually locked; the end date doesn't change.
  - The pool releases the reserve for the remaining days and reserves them again at the new total.
- **Rewards:** the tier's `rateBps` is earned **once over the whole period**, not every day. The whole payout (`amount + amount × rateBps`) is spread evenly over the **full 24h days since lock start**. Unclaimed days accumulate, and earning stops at the period end. Example: 100 locked at 10% per period earns 10 over 7 days (110 total, ≈ 15.7 a day), not 70.
- **Period:** default 7 days. No early unlock. After the end, call `unlock` (returns the NFT and pays out the remaining rewards) or `renew` (pays out the remaining rewards, then takes the new payment and starts a new period; the NFT never moves).
- **Snapshots:** every config change applies to new locks only. Running locks keep their snapshot.
- **Switching the token:** the owner can call `setToken` again at any time (e.g. a new token after a sniped launch).
  - Each lock records the token it was paid in (`Lock.token`). Its reserve, claims, settlement and emergency payout stay in that token until it ends.
  - New locks, renewals and level-ups pay in the new token. A lock paid in the old token can't level up (`LockTokenChanged`); it renews into the new token when it ends.
  - The pool keeps reserves and stats per token (`reservedOf`, `paidOutOf`, `depositedOf`, `withdrawnOf`; `totalReserved()` etc. show the current token). Rewards in the new token are paid only from its own balance, so seed it if its tiers pay over 100%.
  - The old token's free balance can be recovered with `withdrawSurplusOf(oldToken, to, amount)`.
- **Pause:** `pause()` blocks lock, renew and levelUp. **Claim and unlock always work.**
- **Emergency gate:** the owner can send locked guardians home early with `emergencyReturn(ids)` or `emergencyReturnAll(max)` (batches from the global locked set; repeat until `allLockedCount()` is 0).
  - Each holder gets the **full period's** remaining reward (already reserved in the pool), then gets the NFT back.
  - Works while paused. The owner can only send guardians to the holder who locked them, never elsewhere.

## How rewards are funded

Every payment (amount + fee) joins the pool's free balance just before the lock's full-period reward is reserved out of it. The balance splits two ways:

- **Reserved:** rewards promised to running locks.
- **Free fund:** everything else (holders' amounts, the owner's seed, deposits, and the level fees, which stay there). New locks reserve their full-period reward out of it, and the owner can withdraw only from it.

A tier paying ≤ 100% over a period funds itself from the lock's own payment. A tier paying more needs the free fund to cover the excess; a lock it can't cover reverts instead of over-promising. The owner keeps the fund topped up with `deposit`. The admin page flags tiers whose biggest lock the fund can't back.

## Pool security

- Tokens leave the pool only three ways:
  1. claims, to the lock owner;
  2. closing a lock on unlock/renew/emergency return (remaining rewards), to the lock owner;
  3. `withdrawSurplus` / `withdrawSurplusOf`, by the owner, and only the unreserved balance of each token.
- Rewards are reserved when a lock opens. `withdrawSurplus` can never touch them, so even a stolen owner key cannot take rewards already promised to holders.
- The pool ↔ locking wiring is set once. The token can be switched, but reserves are per token, so a switch never frees rewards promised in the old one. `renounceOwnership` is disabled.
- Two-step ownership (`Ownable2Step`). The intended owner is a Safe multisig.
- Reentrancy guards everywhere, and fee-on-transfer tokens are rejected.
- Tests:
  - `forge test` runs the unit/fuzz tests (including the real collection map) plus 4 stateful invariants.
  - The invariants run 256k random locks and renewals at random levels, level-ups, unlocks, claims, emergency returns, owner withdrawals and time jumps and token switches, and every run must include real locks, paid levels and level-ups.
  - They check that the pool always covers every reserve, that the locking contract never holds tokens, that the global locked set matches the guardians held, that each token's reserve matches its open locks (each earning on the amount locked), and that in = out + held for every token.

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
