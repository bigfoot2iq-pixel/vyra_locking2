// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {VyraLocking} from "../src/VyraLocking.sol";
import {IVyraLocking} from "../src/interfaces/IVyraLocking.sol";
import {Base} from "./Base.t.sol";

/// Leveling up a running lock: Common 5%/day, L1 up to 10 free, L2 up to 20 fee 3, L3 up to 30 fee 7,
/// L4 up to 40 fee 12. The fee buys the level for the guardian; the top-up comes back with tribute.
contract LevelUpTest is Base {
    function test_levelUp_settlesThenEarnsOnNewAmount() public {
        lockAs(alice, COMMON_ID, 10e18, 0); // 13.5 over 7 days
        vm.warp(block.timestamp + 3 days);
        uint256 earned = uint256(13.5e18) * 3 / 7;

        uint256 aliceBefore = token.balanceOf(alice);
        uint256 poolBefore = token.balanceOf(address(pool));
        vm.prank(alice);
        locking.levelUp(COMMON_ID, 2, 30e18); // L3: fee 7, top-up 20

        IVyraLocking.Lock memory l = locking.lockOf(COMMON_ID);
        assertEq(l.level, 2);
        assertEq(l.amount, 30e18);
        // alice: -27 paid, + the 3 earned days paid out
        assertEq(aliceBefore - token.balanceOf(alice), 27e18 - earned);
        assertEq(token.balanceOf(address(pool)) - poolBefore, 27e18 - earned);
        // what was left of the 13.5, plus the 20 added back with 4 days at 5% on it (4)
        assertEq(pool.totalReserved(), 13.5e18 - earned + 24e18);
        assertEq(locking.totalLevelPayments(), 7e18);
        assertEq(locking.totalLockPayments(), 30e18);

        vm.warp(block.timestamp + 4 days);
        assertEq(pool.pendingOf(COMMON_ID), 37.5e18 - earned);
        aliceBefore = token.balanceOf(alice);
        vm.prank(alice);
        locking.unlock(ids(COMMON_ID));
        assertEq(token.balanceOf(alice) - aliceBefore, 37.5e18 - earned);
        assertEq(pool.totalReserved(), 0);
        // 30 paid back + tribute 3.5 (10 for 7 days) + 4 (20 for 4 days)
        assertEq(pool.totalPaidOut(), 37.5e18);
        (uint128 total, uint16 from, uint128 before) = pool.scheduleOf(l.lockId);
        assertEq(from, 3);
        assertEq(before, earned, "the 3 days paid before the level-up");
        assertEq(uint256(before) + total, 37.5e18, "the lock's whole payout");
    }

    function test_levelUp_paysOnlyTheFeeDifference() public {
        lockAs(alice, COMMON_ID, 15e18, 1); // L2, fee 3 paid
        uint256 before = token.balanceOf(alice);
        vm.prank(alice);
        locking.levelUp(COMMON_ID, 3, 35e18); // L4 fee 12 → diff 9, top-up 20
        assertEq(before - token.balanceOf(alice), 29e18);
        assertEq(locking.totalLevelPayments(), 12e18);
    }

    /// A level the guardian already owns is free: only the top-up is paid.
    function test_levelUp_isFreeForAnUnlockedLevel() public {
        lockAs(alice, COMMON_ID, 15e18, 1); // L2, fee 3 paid
        vm.warp(block.timestamp + 7 days);
        vm.prank(alice);
        locking.renew(ids(COMMON_ID), ids(5e18), lv(0)); // a new period at L1
        uint256 before = token.balanceOf(alice);
        vm.prank(alice);
        locking.levelUp(COMMON_ID, 1, 20e18); // back to L2: already unlocked
        assertEq(locking.totalLevelPayments(), 3e18, "the level was paid for once");
        assertEq(locking.levelOf(COMMON_ID), 1);
        assertEq(before - token.balanceOf(alice), 15e18, "only the top-up");
    }

    function test_levelUp_keepsEndDate() public {
        lockAs(alice, COMMON_ID, 10e18, 0);
        uint40 end = locking.endOf(COMMON_ID);
        vm.warp(block.timestamp + 2 days);
        vm.prank(alice);
        locking.levelUp(COMMON_ID, 1, 20e18);
        assertEq(locking.endOf(COMMON_ID), end);
    }

    function test_levelUp_onlyWhileRunning() public {
        lockAs(alice, COMMON_ID, 10e18, 0);
        vm.warp(block.timestamp + 7 days);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(VyraLocking.LockEnded.selector, COMMON_ID));
        locking.levelUp(COMMON_ID, 1, 20e18);
    }

    function test_levelUp_notBeforeLocking() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(VyraLocking.NotLocked.selector, COMMON_ID));
        locking.levelUp(COMMON_ID, 1, 20e18);
    }

    function test_levelUp_onlyUpward() public {
        lockAs(alice, COMMON_ID, 15e18, 1);
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(VyraLocking.InvalidLevel.selector, 1));
        locking.levelUp(COMMON_ID, 1, 20e18);
        vm.expectRevert(abi.encodeWithSelector(VyraLocking.InvalidLevel.selector, 0));
        locking.levelUp(COMMON_ID, 0, 10e18);
        vm.expectRevert(abi.encodeWithSelector(VyraLocking.InvalidLevel.selector, 5));
        locking.levelUp(COMMON_ID, 5, 50e18);
        vm.stopPrank();
    }

    function test_levelUp_amountRules() public {
        // force a config where the cap of L3 sits below the locked amount, to hit the "not below locked" rule
        VyraLocking.TierConfig memory t = tier(500, [uint128(10), 20, 30, 40, 50], [uint128(0), 3, 7, 12, 20]);
        vm.prank(owner);
        locking.setTierConfig(0, t);
        lockAs(alice, COMMON_ID, 18e18, 1);
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(VyraLocking.AmountBelowLocked.selector, COMMON_ID, 15e18, 18e18));
        locking.levelUp(COMMON_ID, 2, 15e18);
        vm.expectRevert(
            abi.encodeWithSelector(
                VyraLocking.AmountOutOfRange.selector, COMMON_ID, 31e18, uint128(1), uint128(30e18)
            )
        );
        locking.levelUp(COMMON_ID, 2, 31e18);
        vm.stopPrank();
    }

    function test_levelUp_onlyLockOwner() public {
        lockAs(alice, COMMON_ID, 10e18, 0);
        token.faucet(bob, 100e18);
        vm.startPrank(bob);
        token.approve(address(locking), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(VyraLocking.NotTokenOwner.selector, COMMON_ID));
        locking.levelUp(COMMON_ID, 1, 20e18);
        vm.stopPrank();
    }

    function test_levelUp_pausable() public {
        lockAs(alice, COMMON_ID, 10e18, 0);
        vm.prank(owner);
        locking.pause();
        vm.prank(alice);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        locking.levelUp(COMMON_ID, 1, 20e18);
    }

    function test_levelUp_sameDayTwice() public {
        lockAs(alice, COMMON_ID, 10e18, 0);
        vm.startPrank(alice);
        locking.levelUp(COMMON_ID, 1, 20e18);
        locking.levelUp(COMMON_ID, 3, 40e18);
        vm.stopPrank();
        assertEq(pool.totalReserved(), 54e18, "40 back plus 7 days at 5% on the amounts added");
        assertEq(locking.totalLevelPayments(), 12e18);
    }
}
