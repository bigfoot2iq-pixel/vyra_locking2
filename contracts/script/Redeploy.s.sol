// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {VyraLocking} from "../src/VyraLocking.sol";
import {VyraRewardPool} from "../src/VyraRewardPool.sol";

/// @notice Replaces a live Keep with fresh contracts built from this source. Env:
///   OLD_LOCKING   the Keep being replaced; the broadcaster must own it and its pool
/// Copies everything from the old Keep (NFT, token, rarity map, tiers and levels, duration,
/// rarity freeze), pauses it so no new lock lands there, and moves the old pool's free balance
/// into the new pool. Refuses to run while the old Keep still holds locks.
/// The old tier table has the same shape as this one (rate + cap + price), so it copies verbatim.
/// The collection owner must still allow-list the new locking contract on the transfer validator.
contract Redeploy is Script {
    /// 64 tokens per word: enough for the collection (ids up to 1151).
    uint256 constant RARITY_WORDS = 18;

    function run() external returns (VyraLocking locking, VyraRewardPool pool) {
        VyraLocking old = VyraLocking(vm.envAddress("OLD_LOCKING"));
        VyraRewardPool oldPool = VyraRewardPool(old.pool());
        IERC20 token = old.token();
        require(old.allLockedCount() == 0, "old Keep still holds locks");
        require(oldPool.totalReserved() == 0, "old pool still owes payouts");
        uint256[] memory words = old.rarityWords(0, RARITY_WORDS);
        VyraLocking.TierConfig[5] memory tiers = old.tierConfigs();

        vm.startBroadcast();
        address me = msg.sender;
        require(old.owner() == me && oldPool.owner() == me, "broadcaster must own the old Keep");

        pool = new VyraRewardPool(me);
        locking = new VyraLocking(me, old.nft(), address(pool));
        pool.setLocking(address(locking));
        locking.setRarityWords(0, words);
        if (old.rarityLocked()) locking.lockRarity();
        locking.setToken(token);
        locking.setTierConfigs(tiers);
        if (old.durationDays() != locking.durationDays()) locking.setDurationDays(old.durationDays());

        if (!old.paused()) old.pause();
        uint256 moved = oldPool.available();
        if (moved > 0) {
            oldPool.withdrawSurplus(me, moved);
            token.approve(address(pool), moved);
            pool.deposit(moved);
        }
        vm.stopBroadcast();

        // the copy must match the old Keep exactly
        require(keccak256(abi.encode(locking.tierConfigs())) == keccak256(abi.encode(tiers)), "tiers");
        require(keccak256(abi.encode(locking.rarityWords(0, RARITY_WORDS))) == keccak256(abi.encode(words)), "rarity");

        console.log("VyraRewardPool:", address(pool));
        console.log("VyraLocking:   ", address(locking));
        console.log("Moved to pool: ", moved);

        string memory k = "d";
        vm.serializeAddress(k, "locking", address(locking));
        vm.serializeAddress(k, "pool", address(pool));
        vm.serializeAddress(k, "nft", address(old.nft()));
        string memory json = vm.serializeAddress(k, "token", address(token));
        vm.writeJson(json, string.concat("./deployments/", vm.toString(block.chainid), ".json"));
    }
}
