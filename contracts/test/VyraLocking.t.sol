// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
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
        lockAs(alice, UNCOMMON_ID, 15e18); // Uncommon L1: up to 15, 6% over the period
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
        assertEq(pool.totalReserved(), 8.4e18); // 8 back + 5% of it over the period
        assertEq(pool.available(), SEED + 8e18 - 8.4e18, "the payment joins the free balance");
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
            abi.encodeWithSelector(
                VyraLocking.AmountOutOfRange.selector, COMMON_ID, 11e18, uint128(1), uint128(10e18)
            )
        );
        locking.lock(ids(COMMON_ID), ids(11e18), lv(0));
    }

    /// The bottom of every level is 1: a level only caps the amount, it never raises the floor.
    function test_lock_startsAtOne() public {
        lockAs(alice, COMMON_ID, 1);
        assertEq(locking.lockOf(COMMON_ID).amount, 1);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(VyraLocking.AmountOutOfRange.selector, COMMON_ID_2, 0, uint128(1), uint128(10e18)));
        locking.lock(ids(COMMON_ID_2), ids(0), lv(0));
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

    /// The payment covers its own return; the tribute on top comes out of the seed.
    function test_tributeNeedsSeed() public {
        vm.prank(owner);
        pool.withdrawSurplus(owner, SEED);
        assertEq(token.balanceOf(address(pool)), 0);
        vm.prank(alice);
        // 10 back + 0.5 tribute, the pool only has the 10 just paid
        vm.expectRevert(abi.encodeWithSelector(VyraRewardPool.InsufficientPool.selector, 10.5e18, 10e18));
        locking.lock(ids(COMMON_ID), ids(10e18), lv(0));

        token.faucet(owner, 0.5e18);
        vm.startPrank(owner);
        token.approve(address(pool), 0.5e18);
        pool.deposit(0.5e18);
        vm.stopPrank();
        lockAs(alice, COMMON_ID, 10e18);
        assertEq(pool.totalReserved(), 10.5e18);
        assertEq(pool.available(), 0);
    }

    function test_lockRevertsWhenPoolCannotCoverTribute() public {
        vm.prank(owner);
        pool.withdrawSurplus(owner, SEED);
        vm.prank(alice);
        // legendary 100 tokens at 15% over the period = 100 back + 15 tribute, pool only has the 100 just paid
        vm.expectRevert(abi.encodeWithSelector(VyraRewardPool.InsufficientPool.selector, 115e18, 100e18));
        locking.lock(ids(LEGENDARY_ID), ids(100e18), lv(0));
    }

    /// The level fee buys the level and stays in the pool: it is not paid back and earns nothing.
    /// Common L3, 30 locked at 5% over the period: 30 back + 1.5 tribute, the 7 fee stays where it is.
    function test_levelFeeGoesToThePoolAndIsNotPaidBack() public {
        lockAs(alice, COMMON_ID, 30e18, 2);
        assertEq(locking.levelOf(COMMON_ID), 2, "the level is unlocked for the guardian");
        assertEq(pool.tributeOf(locking.lockOf(COMMON_ID)), 1.5e18);
        assertEq(pool.maxReward(locking.lockOf(COMMON_ID)), 31.5e18);
        assertEq(pool.rewardPerDay(locking.lockOf(COMMON_ID)), uint256(31.5e18) / 7);
        assertEq(pool.totalReserved(), 31.5e18);
        assertEq(pool.available(), SEED + 37e18 - 31.5e18, "the fee stays in the free fund");
    }

    /// The example from the lock page: Common L1, pay 10, get (10 + 0.5) / 7 = 1.5 a day.
    function test_dailyPayout_paymentPlusTribute() public {
        lockAs(alice, COMMON_ID, 10e18, 0);
        IVyraLocking.Lock memory l = locking.lockOf(COMMON_ID);
        assertEq(pool.rewardPerDay(l), uint256(10.5e18) / 7);
        uint256 before = token.balanceOf(alice);
        for (uint256 d = 1; d <= 7; ++d) {
            vm.warp(block.timestamp + 1 days);
            assertEq(pool.pendingOf(COMMON_ID), uint256(10.5e18) * d / 7 - uint256(10.5e18) * (d - 1) / 7);
            vm.prank(alice);
            pool.claim(ids(COMMON_ID));
        }
        assertEq(token.balanceOf(alice) - before, 10.5e18, "the 10 paid plus 0.5");
        assertEq(pool.totalReserved(), 0);
    }

    // ---------------------------------------------------------------- levels (chosen at lock time)

    function test_lockAtHigherLevel_paysFeeIntoPoolAndUnlocksRange() public {
        uint256 poolBefore = token.balanceOf(address(pool));
        lockAs(alice, COMMON_ID, 30e18, 2); // Common L3: up to 30, fee 7
        IVyraLocking.Lock memory l = locking.lockOf(COMMON_ID);
        assertEq(l.level, 2);
        assertEq(l.amount, 30e18);
        assertEq(token.balanceOf(address(pool)) - poolBefore, 37e18, "amount + level fee");
        assertEq(locking.totalLockPayments(), 30e18);
        assertEq(locking.totalLevelPayments(), 7e18);
        assertEq(pool.totalReserved(), 31.5e18, "the amount back, with tribute on it");
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
            abi.encodeWithSelector(
                VyraLocking.AmountOutOfRange.selector, COMMON_ID, 50e18, uint128(1), uint128(30e18)
            )
        );
        locking.lock(ids(COMMON_ID), ids(50e18), lv(2));
        vm.stopPrank();
    }

    /// The level belongs to the guardian, not to the lock: once it is paid for, every later lock
    /// at that level is free.
    function test_levelAccessStaysWithTheGuardian() public {
        lockAs(alice, COMMON_ID, 50e18, 4); // L5: up to 50, fee 20
        assertEq(locking.levelOf(COMMON_ID), 4);
        vm.warp(block.timestamp + 7 days);
        vm.prank(alice);
        locking.renew(ids(COMMON_ID), ids(10e18), lv(0)); // back to L1, free
        assertEq(locking.lockOf(COMMON_ID).level, 0);
        assertEq(locking.levelOf(COMMON_ID), 4, "the level stays unlocked");

        vm.warp(block.timestamp + 7 days);
        vm.prank(alice);
        locking.renew(ids(COMMON_ID), ids(20e18), lv(1)); // L2 again, and free
        assertEq(locking.lockOf(COMMON_ID).level, 1);
        assertEq(locking.totalLevelPayments(), 20e18, "the level was paid for once");
    }

    /// The same after the guardian comes home: locking it again keeps the level it was unlocked at.
    function test_levelAccessSurvivesUnlock() public {
        lockAs(alice, COMMON_ID, 30e18, 2); // L3, fee 7
        vm.warp(block.timestamp + 7 days);
        vm.prank(alice);
        locking.unlock(ids(COMMON_ID));
        assertEq(locking.levelOf(COMMON_ID), 2, "the guardian keeps its level");

        uint256 before = token.balanceOf(alice);
        lockAs(alice, COMMON_ID, 25e18, 2); // the same level again
        assertEq(before - token.balanceOf(alice), 25e18, "no fee the second time");
        assertEq(locking.totalLevelPayments(), 7e18);
        assertEq(locking.lockOf(COMMON_ID).level, 2);
    }

    /// Unlocking a higher level costs what is left of its price; the rest is already paid.
    function test_unlockingAHigherLevelCostsTheDifference() public {
        lockAs(alice, COMMON_ID, 15e18, 1); // L2, fee 3
        (uint8 unlocked, uint128 paid) = locking.accessOf(COMMON_ID);
        assertEq(unlocked, 1);
        assertEq(paid, 3e18);
        assertEq(locking.levelFeeDue(COMMON_ID, COMMON, 3), 9e18, "L4 price 12 - 3 already paid");
        assertEq(locking.levelFeeDue(COMMON_ID, COMMON, 1), 0, "already unlocked");
    }

    function test_level_rejectsOutOfRangeIndex() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(VyraLocking.InvalidLevel.selector, 5));
        locking.lock(ids(COMMON_ID), ids(10e18), lv(5));
    }

    function test_level_rejectsUnavailableOrUnpriced() public {
        VyraLocking.TierConfig memory t = tier(500, [uint128(10), 20, 30, 0, 0], [uint128(0), 0, 7, 7, 7]);
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
        VyraLocking.TierConfig memory t = tier(500, [uint128(10), 20, 30, 40, 50], [uint128(1), 3, 7, 12, 20]);
        vm.expectRevert(abi.encodeWithSelector(VyraLocking.InvalidTierConfig.selector, 0, 0));
        locking.setTierConfig(0, t);
        // caps can't go down
        t = tier(500, [uint128(10), 20, 15, 40, 50], [uint128(0), 3, 7, 12, 20]);
        vm.expectRevert(abi.encodeWithSelector(VyraLocking.InvalidTierConfig.selector, 0, 2));
        locking.setTierConfig(0, t);
        // prices can't go down
        t = tier(500, [uint128(10), 20, 30, 40, 50], [uint128(0), 3, 2, 12, 20]);
        vm.expectRevert(abi.encodeWithSelector(VyraLocking.InvalidTierConfig.selector, 0, 2));
        locking.setTierConfig(0, t);
        // no gaps: level 3 can't exist if level 2 doesn't
        t = tier(500, [uint128(10), 0, 30, 0, 0], [uint128(0), 3, 7, 7, 7]);
        vm.expectRevert(abi.encodeWithSelector(VyraLocking.InvalidTierConfig.selector, 0, 2));
        locking.setTierConfig(0, t);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- claim

    function test_claim_dailyAndAccumulates() public {
        lockAs(alice, COMMON_ID, 4e18); // 5.4 over 7 days
        vm.warp(block.timestamp + 1 days - 1);
        assertEq(pool.pendingOf(COMMON_ID), 0);
        vm.warp(block.timestamp + 1);
        assertEq(pool.pendingOf(COMMON_ID), uint256(4.2e18) / 7);

        uint256 before = token.balanceOf(alice);
        vm.prank(alice);
        pool.claim(ids(COMMON_ID));
        assertEq(token.balanceOf(alice) - before, uint256(4.2e18) / 7);

        vm.prank(alice);
        assertEq(pool.claim(ids(COMMON_ID)), 0, "once per day");

        vm.warp(block.timestamp + 2.5 days);
        assertEq(pool.pendingOf(COMMON_ID), uint256(4.2e18) * 3 / 7 - uint256(4.2e18) / 7, "unclaimed days accumulate");
    }

    function test_claim_capsAtPeriodEnd() public {
        lockAs(alice, COMMON_ID, 4e18);
        vm.warp(block.timestamp + 30 days);
        assertEq(pool.pendingOf(COMMON_ID), 4.2e18);
        vm.prank(alice);
        pool.claim(ids(COMMON_ID));
        assertEq(pool.totalReserved(), 0);
        assertEq(pool.totalPaidOut(), 4.2e18);
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
        pool.claim(ids(COMMON_ID)); // days 1-3

        vm.warp(block.timestamp + 10 days);
        uint256 rest = 4.2e18 - uint256(4.2e18) * 3 / 7;
        uint256 before = token.balanceOf(alice);
        vm.expectEmit(address(locking));
        emit VyraLocking.Unlocked(alice, COMMON_ID, rest);
        vm.prank(alice);
        locking.unlock(ids(COMMON_ID));
        assertEq(token.balanceOf(alice) - before, rest, "remaining days only");
        assertEq(nft.ownerOf(COMMON_ID), alice);
        assertEq(pool.totalReserved(), 0);
        assertEq(locking.totalLocked(), 0);
    }

    /// The full round trip: the holder gets the locked amount back plus 7 days of tribute on it.
    /// The level fee stays in the pool.
    function test_unlock_returnsPaymentPlusTribute() public {
        uint256 start = token.balanceOf(alice);
        lockAs(alice, COMMON_ID, 30e18, 2); // L3: 30 + 7 fee, 1.5 tribute
        assertEq(start - token.balanceOf(alice), 37e18);
        vm.warp(block.timestamp + 7 days);
        vm.prank(alice);
        locking.unlock(ids(COMMON_ID));
        assertEq(token.balanceOf(alice), start + 1.5e18 - 7e18, "30 back + 1.5 tribute - 7 fee");
        assertEq(token.balanceOf(address(pool)), SEED + 5.5e18, "the fee stays, the seed pays the tribute");
    }

    function test_unlock_batchRejectsRepeatedId() public {
        lockAs(alice, COMMON_ID, 4e18);
        vm.warp(block.timestamp + 7 days);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(VyraLocking.NotLocked.selector, COMMON_ID));
        locking.unlock(ids(COMMON_ID, COMMON_ID));
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
        assertEq(before + 4.2e18 - 2e18, token.balanceOf(alice), "old payout out, new amount in");
        IVyraLocking.Lock memory l = locking.lockOf(COMMON_ID);
        assertGt(l.lockId, firstId);
        assertEq(l.start, block.timestamp);
        assertEq(pool.totalReserved(), 2.1e18);
        assertEq(nft.ownerOf(COMMON_ID), address(locking));
    }

    /// A renewal can be paid with what the old period just paid back.
    function test_renew_paidFromRewards() public {
        lockAs(alice, COMMON_ID, 10e18); // 10.5 over the period
        vm.warp(block.timestamp + 7 days);
        vm.startPrank(alice);
        token.transfer(bob, token.balanceOf(alice));
        locking.renew(ids(COMMON_ID), ids(10e18), lv(0));
        vm.stopPrank();
        assertEq(token.balanceOf(alice), 0.5e18);
    }

    function test_renew_batchRejectsRepeatedId() public {
        lockAs(alice, COMMON_ID, 4e18);
        vm.warp(block.timestamp + 7 days);
        uint40 end = uint40(block.timestamp + 7 days);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(VyraLocking.LockNotEnded.selector, COMMON_ID, end));
        locking.renew(ids(COMMON_ID, COMMON_ID), ids(4e18, 4e18), new uint8[](2));
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
        lockAs(alice, LEGENDARY_ID, 50e18); // pays 50, reserves 50 + 7.5
        uint256 free = pool.available();
        assertEq(free, SEED + 50e18 - 57.5e18);
        vm.startPrank(owner);
        vm.expectRevert(abi.encodeWithSelector(VyraRewardPool.ExceedsSurplus.selector, free + 1, free));
        pool.withdrawSurplus(owner, free + 1);
        pool.withdrawSurplus(owner, free);
        vm.stopPrank();

        uint256 before = token.balanceOf(alice);
        vm.warp(block.timestamp + 7 days);
        vm.prank(alice);
        locking.unlock(ids(LEGENDARY_ID)); // still fully paid
        assertEq(token.balanceOf(alice) - before, 57.5e18);
        assertEq(token.balanceOf(address(pool)), 0);
        assertEq(pool.totalPaidOut(), 57.5e18);
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

    function test_pool_cannotWithdrawReservedRewards() public {
        lockAs(alice, COMMON_ID, 4e18); // pays 4, reserves 4.2
        uint256 free = pool.availableOf(token);
        assertEq(free, SEED + 4e18 - 4.2e18);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(VyraRewardPool.ExceedsSurplus.selector, free + 1, free));
        pool.withdrawSurplusOf(token, owner, free + 1);
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
        t.rateBps = 9000;
        locking.setTierConfig(0, t);
        locking.setDurationDays(30);
        vm.stopPrank();

        vm.warp(block.timestamp + 60 days);
        assertEq(pool.pendingOf(COMMON_ID), 4.2e18);
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

    function test_setTokenRejectsSameOrZero() public {
        vm.startPrank(owner);
        vm.expectRevert(VyraLocking.SameToken.selector);
        locking.setToken(token);
        vm.expectRevert(VyraLocking.ZeroAddress.selector);
        locking.setToken(IERC20(address(0)));
        vm.stopPrank();
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

    // ---------------------------------------------------------------- emergency gate

    function test_emergencyReturn_paysFullPeriodAndReturnsNft() public {
        lockAs(alice, COMMON_ID, 4e18); // 5.4 over 7 days
        vm.warp(block.timestamp + 2 days);
        vm.prank(alice);
        pool.claim(ids(COMMON_ID)); // days 1-2

        uint256 rest = 4.2e18 - uint256(4.2e18) * 2 / 7;
        uint256 before = token.balanceOf(alice);
        vm.expectEmit(address(locking));
        emit VyraLocking.EmergencyReturned(alice, COMMON_ID, rest);
        vm.prank(owner);
        locking.emergencyReturn(ids(COMMON_ID));

        assertEq(token.balanceOf(alice) - before, rest); // the 5 remaining days
        assertEq(nft.ownerOf(COMMON_ID), alice);
        assertEq(locking.lockOf(COMMON_ID).owner, address(0));
        assertEq(locking.lockedTokensOf(alice).length, 0);
        assertEq(locking.allLockedCount(), 0);
        assertEq(locking.totalLocked(), 0);
        assertEq(pool.totalReserved(), 0);
    }

    function test_emergencyReturn_worksWhilePausedAndAfterLevelUp() public {
        lockAs(alice, COMMON_ID, 4e18);
        vm.warp(block.timestamp + 1 days);
        vm.prank(alice);
        locking.levelUp(COMMON_ID, 1, 12e18); // pays day 1; the 8 added earns 6 of the 7 days' tribute
        vm.prank(owner);
        locking.pause();

        uint256 before = token.balanceOf(alice);
        vm.prank(owner);
        locking.emergencyReturn(ids(COMMON_ID));
        // the rest of the first 4.2, plus the 8 added back with its pro-rata tribute
        assertEq(token.balanceOf(alice) - before, 4.2e18 - uint256(4.2e18) / 7 + 8e18 + uint256(8e18) * 500 * 6 / 70_000);
        assertEq(nft.ownerOf(COMMON_ID), alice);
        assertEq(pool.totalReserved(), 0);
    }

    function test_emergencyReturn_afterPeriodEndPaysOnlyWhatIsLeft() public {
        lockAs(alice, COMMON_ID, 4e18);
        vm.warp(block.timestamp + 30 days);
        uint256 before = token.balanceOf(alice);
        vm.prank(owner);
        locking.emergencyReturn(ids(COMMON_ID));
        assertEq(token.balanceOf(alice) - before, 4.2e18);
    }

    function test_emergencyReturn_ownerOnlyAndLockedOnly() public {
        lockAs(alice, COMMON_ID, 4e18);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        locking.emergencyReturn(ids(COMMON_ID));

        vm.startPrank(owner);
        vm.expectRevert(abi.encodeWithSelector(VyraLocking.NotLocked.selector, COMMON_ID_2));
        locking.emergencyReturn(ids(COMMON_ID_2));
        vm.expectRevert(VyraLocking.EmptyInput.selector);
        locking.emergencyReturn(new uint256[](0));
        vm.stopPrank();
    }

    function test_emergencyReturnAll_inBatches() public {
        nft.mint(bob, 2); // ids 11, 12 (Common)
        token.faucet(bob, 100e18);
        vm.startPrank(bob);
        nft.setApprovalForAll(address(locking), true);
        token.approve(address(locking), type(uint256).max);
        vm.stopPrank();

        lockAs(alice, COMMON_ID, 4e18);
        lockAs(alice, LEGENDARY_ID, 50e18);
        lockAs(bob, 11, 2e18);
        lockAs(bob, 12, 2e18);
        assertEq(locking.allLockedCount(), 4);
        assertEq(locking.allLockedTokens(1, 10).length, 3);
        assertEq(locking.allLockedTokens(9, 1).length, 0);

        vm.startPrank(owner);
        assertEq(locking.emergencyReturnAll(3), 3);
        assertEq(locking.allLockedCount(), 1);
        assertEq(locking.emergencyReturnAll(10), 1);
        assertEq(locking.emergencyReturnAll(10), 0);
        vm.stopPrank();

        assertEq(nft.ownerOf(COMMON_ID), alice);
        assertEq(nft.ownerOf(LEGENDARY_ID), alice);
        assertEq(nft.ownerOf(11), bob);
        assertEq(nft.ownerOf(12), bob);
        assertEq(locking.totalLocked(), 0);
        assertEq(pool.totalReserved(), 0);
        assertEq(token.balanceOf(bob), 100e18 + 0.2e18, "bob: paid 4, got it back plus 2 x 0.1 tribute");
    }

    function test_pool_onlyLockingCanClose() public {
        vm.expectRevert(VyraRewardPool.NotLocking.selector);
        pool.closeFull(COMMON_ID);
        vm.expectRevert(VyraRewardPool.NotLocking.selector);
        pool.close(COMMON_ID);
    }

    // ---------------------------------------------------------------- fuzz

    /// Total paid out over a full period always equals the reserve (payment + tribute), however
    /// claims are spaced.
    function testFuzz_rewardsMatchReserve(uint128 amount, uint8 claimEvery, uint16 rateBps) public {
        amount = uint128(bound(amount, 1e18, 10e18));
        rateBps = uint16(bound(rateBps, 1, 1_400)); // tribute ≤ 14% of the amount, inside the seed
        claimEvery = uint8(bound(claimEvery, 1, 9));
        VyraLocking.TierConfig memory t = defaultTiers()[0];
        t.rateBps = rateBps;
        vm.prank(owner);
        locking.setTierConfig(0, t);

        lockAs(alice, COMMON_ID, amount);
        uint256 reserved = pool.totalReserved();
        assertEq(reserved, amount + uint256(amount) * rateBps / 10_000);
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
