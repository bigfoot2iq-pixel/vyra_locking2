// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {VyraLocking} from "../src/VyraLocking.sol";
import {VyraRewardPool} from "../src/VyraRewardPool.sol";
import {IVyraLocking} from "../src/interfaces/IVyraLocking.sol";
import {Base} from "./Base.t.sol";

contract VyraLockingTest is Base {
    // ---------------------------------------------------------------- rarity

    function test_tierFromRarityMap() public view {
        assertEq(locking.baseTierOf(LEGENDARY_ID), LEGENDARY);
        assertEq(locking.baseTierOf(EPIC_ID), EPIC);
        assertEq(locking.baseTierOf(RARE_ID), RARE);
        assertEq(locking.baseTierOf(UNCOMMON_ID), UNCOMMON);
        assertEq(locking.baseTierOf(COMMON_ID), COMMON);
        assertEq(locking.baseTierOf(1111), COMMON, "unmapped ids are Common");
    }

    /// Every id 1..1111 maps exactly, across word boundaries.
    function testFuzz_rarityMapRoundTrip(uint256 seed) public {
        uint8[] memory tiers = new uint8[](1112);
        for (uint256 id = 1; id <= 1111; ++id) {
            tiers[id] = uint8(uint256(keccak256(abi.encode(seed, id))) % 5);
        }
        uint256[] memory words = packTiers(tiers);
        assertEq(words.length, 18);
        vm.prank(owner);
        locking.setRarityWords(0, words);
        for (uint256 id = 1; id <= 1111; ++id) {
            assertEq(locking.baseTierOf(id), tiers[id]);
        }
        assertEq(locking.rarityWords(0, 18), words);
    }

    function test_rarityWords_rejectInvalidTier() public {
        uint256[] memory words = new uint256[](1);
        words[0] = uint256(5) << (7 * 4); // token 7 → tier 5 (doesn't exist)
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(VyraLocking.InvalidRarityWord.selector, 0, 7));
        locking.setRarityWords(0, words);
    }

    function test_rarityWords_partialUpdate() public {
        uint256[] memory words = new uint256[](1);
        words[0] = uint256(LEGENDARY) << (40 * 4); // token 1000 = word 15, slot 40
        vm.prank(owner);
        locking.setRarityWords(15, words);
        assertEq(locking.baseTierOf(1000), LEGENDARY);
        assertEq(locking.baseTierOf(LEGENDARY_ID), LEGENDARY, "other words untouched");
    }

    function test_rarityLock_isPermanent() public {
        vm.startPrank(owner);
        locking.lockRarity();
        vm.expectRevert(VyraLocking.RarityIsLocked.selector);
        locking.setRarityWords(0, new uint256[](1));
        vm.stopPrank();
    }

    function test_rarityAdminOnly() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        locking.setRarityWords(0, new uint256[](1));
    }

    function test_uncommonTierLocksWithItsOwnConfig() public {
        lockAs(alice, UNCOMMON_ID, 15e18); // Uncommon L1: 3-15, 6%/day
        IVyraLocking.Lock memory l = locking.lockOf(UNCOMMON_ID);
        assertEq(l.tier, UNCOMMON);
        assertEq(l.rateBps, 600);
        vm.prank(alice);
        vm.expectRevert();
        locking.lock(ids(10), ids(16e18), lv(0)); // id 10 is Uncommon too: 16 > 15
    }

    // ---------------------------------------------------------------- lock: everything goes to the pool

    function test_lock_paysPoolInFull_nothingBurned() public {
        uint256 supply = token.totalSupply();
        lockAs(alice, COMMON_ID, 8e18);

        assertEq(token.totalSupply(), supply, "nothing burned");
        assertEq(token.balanceOf(address(pool)), SEED + 8e18, "100% to pool");
        assertEq(token.balanceOf(address(locking)), 0, "locking holds no tokens");
        assertEq(nft.ownerOf(COMMON_ID), address(locking));
        assertEq(pool.totalReserved(), 2.8e18); // 8 * 5% * 7
        assertEq(locking.totalLockPayments(), 8e18);

        IVyraLocking.Lock memory l = locking.lockOf(COMMON_ID);
        assertEq(l.owner, alice);
        assertEq(l.tier, 0);
        assertEq(l.level, 0);
        assertEq(l.amount, 8e18);
        assertEq(l.rateBps, 500);
        assertEq(l.durationDays, 7);
        assertEq(locking.lockedTokensOf(alice).length, 1);
    }

    function test_lock_cannotExceedLevelMax() public {
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(VyraLocking.AmountOutOfRange.selector, COMMON_ID, 11e18, uint128(1e18), uint128(10e18))
        );
        locking.lock(ids(COMMON_ID), ids(11e18), lv(0));
    }

    function test_lock_cannotGoBelowLevelMin() public {
        vm.prank(alice);
        vm.expectRevert();
        locking.lock(ids(LEGENDARY_ID), ids(49e18), lv(0));
    }

    function test_lock_revertsIfNotOwner() public {
        token.faucet(bob, 100e18);
        vm.startPrank(bob);
        token.approve(address(locking), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(VyraLocking.NotTokenOwner.selector, COMMON_ID));
        locking.lock(ids(COMMON_ID), ids(5e18), lv(0));
        vm.stopPrank();
    }

    function test_lock_tierClosedWhenLevelOneEmpty() public {
        VyraLocking.TierConfig memory closed;
        vm.prank(owner);
        locking.setTierConfig(0, closed);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(VyraLocking.LevelNotAvailable.selector, 0, 0));
        locking.lock(ids(COMMON_ID), ids(5e18), lv(0));
    }

    /// Tiers paying ≤ 100% over a period fund themselves: works even with an empty pool.
    function test_selfFunding_whenReturnAtMost100Percent() public {
        vm.prank(owner);
        pool.withdrawSurplus(owner, SEED);
        assertEq(token.balanceOf(address(pool)), 0);
        lockAs(alice, COMMON_ID, 10e18); // 35% return
        assertEq(pool.totalReserved(), 3.5e18);
    }

    /// Tiers paying > 100% need pool surplus (seed + upgrade income) to cover the excess.
    function test_lockRevertsWhenPoolCannotCoverExcess() public {
        vm.prank(owner);
        pool.withdrawSurplus(owner, SEED);
        vm.prank(alice);
        // legendary 100 tokens at 15%/day for 7 days = 105 reserve, pool only has the 100 just paid
        vm.expectRevert(abi.encodeWithSelector(VyraRewardPool.InsufficientPool.selector, 105e18, 100e18));
        locking.lock(ids(LEGENDARY_ID), ids(100e18), lv(0));
    }

    // ---------------------------------------------------------------- levels (chosen at lock time)

    function test_lockAtHigherLevel_paysFeeIntoPoolAndUnlocksRange() public {
        uint256 poolBefore = token.balanceOf(address(pool));
        lockAs(alice, COMMON_ID, 30e18, 2); // Common L3: 21-30, fee 7
        IVyraLocking.Lock memory l = locking.lockOf(COMMON_ID);
        assertEq(l.level, 2);
        assertEq(l.amount, 30e18);
        assertEq(token.balanceOf(address(pool)) - poolBefore, 37e18, "amount + level fee");
        assertEq(locking.totalLockPayments(), 30e18);
        assertEq(locking.totalLevelPayments(), 7e18);
        assertEq(pool.totalReserved(), 10.5e18, "rewards only on the locked amount");
    }

    function test_levelOneIsFree() public {
        uint256 before = token.balanceOf(alice);
        lockAs(alice, COMMON_ID, 10e18, 0);
        assertEq(before - token.balanceOf(alice), 10e18);
        assertEq(locking.totalLevelPayments(), 0);
    }

    function test_amountMustFitChosenLevel() public {
        vm.startPrank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(VyraLocking.AmountOutOfRange.selector, COMMON_ID, 50e18, uint128(21e18), uint128(30e18))
        );
        locking.lock(ids(COMMON_ID), ids(50e18), lv(2));
        vm.expectRevert(
            abi.encodeWithSelector(VyraLocking.AmountOutOfRange.selector, COMMON_ID, 10e18, uint128(21e18), uint128(30e18))
        );
        locking.lock(ids(COMMON_ID), ids(10e18), lv(2));
        vm.stopPrank();
    }

    function test_renewCanChangeLevel() public {
        lockAs(alice, COMMON_ID, 50e18, 4); // L5
        vm.warp(block.timestamp + 7 days);
        vm.prank(alice);
        locking.renew(ids(COMMON_ID), ids(10e18), lv(0)); // back to L1, free
        assertEq(locking.lockOf(COMMON_ID).level, 0);

        vm.warp(block.timestamp + 7 days);
        vm.prank(alice);
        locking.renew(ids(COMMON_ID), ids(20e18), lv(1)); // L2 again costs its fee again
        assertEq(locking.lockOf(COMMON_ID).level, 1);
        assertEq(locking.totalLevelPayments(), 20e18 + 3e18);
    }

    function test_level_rejectsOutOfRangeIndex() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(VyraLocking.InvalidLevel.selector, 5));
        locking.lock(ids(COMMON_ID), ids(10e18), lv(5));
    }

    function test_level_rejectsUnavailableOrUnpriced() public {
        VyraLocking.TierConfig memory t = tier(
            500, [uint128(1), 11, 21, 0, 0], [uint128(10), 20, 30, 0, 0], [uint128(0), 0, 7, 7, 7]
        );
        vm.prank(owner);
        locking.setTierConfig(0, t);
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(VyraLocking.LevelNotPriced.selector, 0, 1));
        locking.lock(ids(COMMON_ID), ids(15e18), lv(1));
        vm.expectRevert(abi.encodeWithSelector(VyraLocking.LevelNotAvailable.selector, 0, 3));
        locking.lock(ids(COMMON_ID), ids(35e18), lv(3));
        vm.stopPrank();
    }

    function test_levelPrice_view() public view {
        assertEq(locking.levelPrice(COMMON, 0), 0);
        assertEq(locking.levelPrice(COMMON, 4), 20e18);
        assertEq(locking.levelPrice(LEGENDARY, 2), 20e18);
    }

    function test_batchLock_mixedLevels() public {
        uint8[] memory levels = new uint8[](2);
        levels[1] = 1; // COMMON_ID_2 at L2
        uint256 before = token.balanceOf(alice);
        vm.prank(alice);
        locking.lock(ids(COMMON_ID, COMMON_ID_2), ids(5e18, 15e18), levels);
        assertEq(before - token.balanceOf(alice), 5e18 + 15e18 + 3e18);
        assertEq(locking.lockOf(COMMON_ID).level, 0);
        assertEq(locking.lockOf(COMMON_ID_2).level, 1);
    }

    function test_tierConfig_validation() public {
        vm.startPrank(owner);
        // level 1 must be free
        VyraLocking.TierConfig memory t = tier(500, [uint128(1), 11, 21, 31, 41], [uint128(10), 20, 30, 40, 50], [uint128(1), 3, 7, 12, 20]);
        vm.expectRevert(abi.encodeWithSelector(VyraLocking.InvalidTierConfig.selector, 0, 0));
        locking.setTierConfig(0, t);
        // caps can't go down
        t = tier(500, [uint128(1), 11, 21, 31, 41], [uint128(10), 20, 15, 40, 50], [uint128(0), 3, 7, 12, 20]);
        vm.expectRevert(abi.encodeWithSelector(VyraLocking.InvalidTierConfig.selector, 0, 2));
        locking.setTierConfig(0, t);
        // prices can't go down
        t = tier(500, [uint128(1), 11, 21, 31, 41], [uint128(10), 20, 30, 40, 50], [uint128(0), 3, 2, 12, 20]);
        vm.expectRevert(abi.encodeWithSelector(VyraLocking.InvalidTierConfig.selector, 0, 2));
        locking.setTierConfig(0, t);
        // no gaps: level 3 can't exist if level 2 doesn't
        t = tier(500, [uint128(1), 0, 21, 0, 0], [uint128(10), 0, 30, 0, 0], [uint128(0), 3, 7, 7, 7]);
        vm.expectRevert(abi.encodeWithSelector(VyraLocking.InvalidTierConfig.selector, 0, 2));
        locking.setTierConfig(0, t);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- claim

    function test_claim_dailyAndAccumulates() public {
        lockAs(alice, COMMON_ID, 4e18); // 0.2e18 per day
        vm.warp(block.timestamp + 1 days - 1);
        assertEq(pool.pendingOf(COMMON_ID), 0);
        vm.warp(block.timestamp + 1);
        assertEq(pool.pendingOf(COMMON_ID), 0.2e18);

        uint256 before = token.balanceOf(alice);
        vm.prank(alice);
        pool.claim(ids(COMMON_ID));
        assertEq(token.balanceOf(alice) - before, 0.2e18);

        vm.prank(alice);
        assertEq(pool.claim(ids(COMMON_ID)), 0, "once per day");

        vm.warp(block.timestamp + 2.5 days);
        assertEq(pool.pendingOf(COMMON_ID), 0.4e18, "unclaimed days accumulate");
    }

    function test_claim_capsAtPeriodEnd() public {
        lockAs(alice, COMMON_ID, 4e18);
        vm.warp(block.timestamp + 30 days);
        assertEq(pool.pendingOf(COMMON_ID), 1.4e18);
        vm.prank(alice);
        pool.claim(ids(COMMON_ID));
        assertEq(pool.totalReserved(), 0);
        assertEq(pool.totalPaidOut(), 1.4e18);
    }

    function test_claim_revertsForNonOwner() public {
        lockAs(alice, COMMON_ID, 4e18);
        vm.warp(block.timestamp + 2 days);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(VyraRewardPool.NotLockOwner.selector, COMMON_ID));
        pool.claim(ids(COMMON_ID));
    }

    // ---------------------------------------------------------------- unlock / renew

    function test_unlock_revertsBeforeEnd() public {
        lockAs(alice, COMMON_ID, 4e18);
        vm.warp(block.timestamp + 7 days - 1);
        vm.prank(alice);
        vm.expectRevert();
        locking.unlock(ids(COMMON_ID));
    }

    function test_unlock_paysRemainingAndReturnsNft() public {
        lockAs(alice, COMMON_ID, 4e18);
        vm.warp(block.timestamp + 3 days);
        vm.prank(alice);
        pool.claim(ids(COMMON_ID)); // 0.6

        vm.warp(block.timestamp + 10 days);
        uint256 before = token.balanceOf(alice);
        vm.prank(alice);
        locking.unlock(ids(COMMON_ID));
        assertEq(token.balanceOf(alice) - before, 0.8e18);
        assertEq(nft.ownerOf(COMMON_ID), alice);
        assertEq(pool.totalReserved(), 0);
        assertEq(locking.totalLocked(), 0);
    }

    function test_unlock_revertsForNonOwner() public {
        lockAs(alice, COMMON_ID, 4e18);
        vm.warp(block.timestamp + 8 days);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(VyraLocking.NotTokenOwner.selector, COMMON_ID));
        locking.unlock(ids(COMMON_ID));
    }

    function test_renew_settlesAndStartsNewPeriod() public {
        lockAs(alice, COMMON_ID, 4e18);
        uint64 firstId = locking.lockOf(COMMON_ID).lockId;
        vm.warp(block.timestamp + 7 days);

        uint256 before = token.balanceOf(alice);
        vm.prank(alice);
        locking.renew(ids(COMMON_ID), ids(2e18), lv(0));
        assertEq(before + 1.4e18 - 2e18, token.balanceOf(alice));
        IVyraLocking.Lock memory l = locking.lockOf(COMMON_ID);
        assertGt(l.lockId, firstId);
        assertEq(l.start, block.timestamp);
        assertEq(pool.totalReserved(), 0.7e18);
        assertEq(nft.ownerOf(COMMON_ID), address(locking));
    }

    // ---------------------------------------------------------------- pool security

    function test_pool_anyoneCanDeposit() public {
        token.faucet(bob, 5e18);
        vm.startPrank(bob);
        token.approve(address(pool), 5e18);
        pool.deposit(5e18);
        vm.stopPrank();
        assertEq(pool.totalDeposited(), SEED + 5e18);
    }

    function test_pool_onlyOwnerWithdraws() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        pool.withdrawSurplus(alice, 1);
    }

    function test_pool_ownerCannotTouchReserved() public {
        lockAs(alice, LEGENDARY_ID, 100e18); // reserves 105
        uint256 free = pool.available();
        assertEq(free, SEED + 100e18 - 105e18);
        vm.startPrank(owner);
        vm.expectRevert(abi.encodeWithSelector(VyraRewardPool.ExceedsSurplus.selector, free + 1, free));
        pool.withdrawSurplus(owner, free + 1);
        pool.withdrawSurplus(owner, free);
        vm.stopPrank();

        vm.warp(block.timestamp + 7 days);
        vm.prank(alice);
        locking.unlock(ids(LEGENDARY_ID)); // still fully paid
        assertEq(token.balanceOf(address(pool)), 0);
        assertEq(pool.totalPaidOut(), 105e18);
    }

    function test_pool_onlyLockingCanReserveOrSettle() public {
        vm.startPrank(owner);
        vm.expectRevert(VyraRewardPool.NotLocking.selector);
        pool.reserve(COMMON_ID);
        vm.expectRevert(VyraRewardPool.NotLocking.selector);
        pool.settle(COMMON_ID);
        vm.expectRevert(VyraRewardPool.LockingAlreadySet.selector);
        pool.setLocking(owner);
        vm.stopPrank();
    }

    function test_pool_cannotRescuePoolToken() public {
        vm.prank(owner);
        vm.expectRevert(VyraRewardPool.CannotRescuePoolToken.selector);
        pool.rescueERC20(token, owner, 1);
    }

    function test_renounceDisabled() public {
        vm.startPrank(owner);
        vm.expectRevert(VyraRewardPool.RenounceDisabled.selector);
        pool.renounceOwnership();
        vm.expectRevert(VyraLocking.RenounceDisabled.selector);
        locking.renounceOwnership();
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- admin & safety

    function test_configChangesDoNotAffectRunningLock() public {
        lockAs(alice, COMMON_ID, 4e18);
        vm.startPrank(owner);
        VyraLocking.TierConfig memory t = defaultTiers()[0];
        t.dailyRateBps = 9000;
        locking.setTierConfig(0, t);
        locking.setDurationDays(30);
        vm.stopPrank();

        vm.warp(block.timestamp + 60 days);
        assertEq(pool.pendingOf(COMMON_ID), 1.4e18);
        vm.prank(alice);
        locking.unlock(ids(COMMON_ID));
    }

    function test_pauseBlocksEntryButNotExit() public {
        lockAs(alice, COMMON_ID, 4e18);
        vm.prank(owner);
        locking.pause();

        vm.startPrank(alice);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        locking.lock(ids(COMMON_ID_2), ids(2e18), lv(0));
        vm.warp(block.timestamp + 7 days);
        pool.claim(ids(COMMON_ID));
        locking.unlock(ids(COMMON_ID));
        vm.stopPrank();
        assertEq(nft.ownerOf(COMMON_ID), alice);
    }

    function test_adminOnly() public {
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        locking.setDurationDays(1);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        locking.pause();
        vm.stopPrank();
    }

    function test_tokenIsSetOnce() public {
        vm.prank(owner);
        vm.expectRevert(VyraLocking.TokenAlreadySet.selector);
        locking.setToken(token);
    }

    function test_rescueCannotTakeLockedNft() public {
        lockAs(alice, COMMON_ID, 4e18);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(VyraLocking.TokenIsLocked.selector, COMMON_ID));
        locking.rescueERC721(COMMON_ID, owner);
    }

    function test_directSafeTransferIsRejected() public {
        vm.prank(alice);
        vm.expectRevert();
        nft.safeTransferFrom(alice, address(locking), COMMON_ID);
    }

    // ---------------------------------------------------------------- fuzz

    /// Total paid out over a full period always equals the reserve, however claims are spaced.
    function testFuzz_rewardsMatchReserve(uint128 amount, uint8 claimEvery, uint16 rateBps) public {
        amount = uint128(bound(amount, 1e18, 10e18));
        rateBps = uint16(bound(rateBps, 1, 1_400)); // ≤ 98% over 7 days: self-funded
        claimEvery = uint8(bound(claimEvery, 1, 9));
        VyraLocking.TierConfig memory t = defaultTiers()[0];
        t.dailyRateBps = rateBps;
        vm.prank(owner);
        locking.setTierConfig(0, t);

        lockAs(alice, COMMON_ID, amount);
        uint256 reserved = pool.totalReserved();
        uint256 before = token.balanceOf(alice);
        for (uint256 d; d < 8; d += claimEvery) {
            vm.warp(block.timestamp + uint256(claimEvery) * 1 days);
            vm.prank(alice);
            pool.claim(ids(COMMON_ID));
        }
        vm.prank(alice);
        locking.unlock(ids(COMMON_ID));
        assertEq(token.balanceOf(alice) - before, reserved);
        assertEq(pool.totalReserved(), 0);
    }
}
