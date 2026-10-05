// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {VyraLocking} from "../src/VyraLocking.sol";
import {VyraRewardPool} from "../src/VyraRewardPool.sol";
import {MockToken} from "../src/mocks/MockToken.sol";
import {Base} from "./Base.t.sol";

/// The owner switches the payment token (e.g. after a sniped launch). Running locks finish in the
/// token they were paid in; everything new uses the new token.
contract TokenSwitchTest is Base {
    MockToken next;

    function setUp() public override {
        super.setUp();
        next = new MockToken();
        next.faucet(alice, 10_000e18);
        vm.prank(alice);
        next.approve(address(locking), type(uint256).max);
    }

    function _switch() internal {
        vm.prank(owner);
        locking.setToken(next);
    }

    function test_onlyOwnerCanSwitch() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        locking.setToken(next);
    }

    function test_switchEmitsAndApplies() public {
        vm.expectEmit(address(locking));
        emit VyraLocking.TokenSet(address(token), address(next));
        _switch();
        assertEq(address(locking.token()), address(next));
        assertEq(address(pool.token()), address(next));
    }

    function test_runningLockFinishesInOldToken() public {
        lockAs(alice, COMMON_ID, 4e18); // 0.2/day for 7 days, paid in `token`
        _switch();
        assertEq(address(locking.lockOf(COMMON_ID).token), address(token));
        assertEq(pool.reservedOf(token), 1.4e18);
        assertEq(pool.totalReserved(), 0, "stats follow the current token");

        vm.warp(block.timestamp + 3 days);
        uint256 before = token.balanceOf(alice);
        vm.prank(alice);
        pool.claim(ids(COMMON_ID));
        assertEq(token.balanceOf(alice) - before, 0.6e18);

        vm.warp(block.timestamp + 4 days);
        vm.prank(alice);
        locking.unlock(ids(COMMON_ID));
        assertEq(token.balanceOf(alice) - before, 1.4e18);
        assertEq(pool.reservedOf(token), 0);
        assertEq(pool.paidOutOf(token), 1.4e18);
        assertEq(nft.ownerOf(COMMON_ID), alice);
    }

    function test_newLocksPayInNewToken() public {
        _switch();
        uint256 oldBefore = token.balanceOf(alice);
        uint256 newBefore = next.balanceOf(alice);
        lockAs(alice, COMMON_ID, 12e18, 1); // level 2: 11-20, 3 fee
        assertEq(token.balanceOf(alice), oldBefore, "old token untouched");
        assertEq(newBefore - next.balanceOf(alice), 12e18 + 3e18);
        assertEq(next.balanceOf(address(pool)), 15e18);
        assertEq(pool.reservedOf(next), 4.2e18);
        assertEq(locking.totalLockPayments(), 12e18);
        assertEq(locking.totalLevelPayments(), 3e18);
        assertEq(locking.lockPaymentsOf(token), 0);
    }

    function test_newLockCannotDrawOnOldTokenSurplus() public {
        // Legendary 15%/day × 7 = 105% of the amount: needs a seed in the new token
        _switch();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(VyraRewardPool.InsufficientPool.selector, 52.5e18, 50e18));
        locking.lock(ids(LEGENDARY_ID), ids(50e18), lv(0));
    }

    function test_oldLockCannotLevelUpAfterSwitch() public {
        lockAs(alice, COMMON_ID, 4e18);
        _switch();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(VyraLocking.LockTokenChanged.selector, COMMON_ID));
        locking.levelUp(COMMON_ID, 1, 12e18);
    }

    function test_renewMovesLockToNewToken() public {
        lockAs(alice, COMMON_ID, 4e18);
        _switch();
        vm.warp(block.timestamp + 7 days);
        uint256 oldBefore = token.balanceOf(alice);
        uint256 newBefore = next.balanceOf(alice);
        vm.prank(alice);
        locking.renew(ids(COMMON_ID), ids(6e18), lv(0));

        assertEq(token.balanceOf(alice) - oldBefore, 1.4e18, "old period paid out in the old token");
        assertEq(newBefore - next.balanceOf(alice), 6e18, "new period paid in the new token");
        assertEq(address(locking.lockOf(COMMON_ID).token), address(next));
        assertEq(pool.reservedOf(token), 0);
        assertEq(pool.reservedOf(next), 2.1e18);

        // and it can level up again
        vm.prank(alice);
        locking.levelUp(COMMON_ID, 1, 12e18);
        assertEq(locking.lockOf(COMMON_ID).level, 1);
    }

    function test_claimPaysEachLockInItsOwnToken() public {
        lockAs(alice, COMMON_ID, 4e18); // old token, 0.2/day
        _switch();
        lockAs(alice, COMMON_ID_2, 2e18); // new token, 0.1/day
        vm.warp(block.timestamp + 2 days);
        uint256 oldBefore = token.balanceOf(alice);
        uint256 newBefore = next.balanceOf(alice);
        vm.prank(alice);
        uint256 total = pool.claim(ids(COMMON_ID, COMMON_ID_2));
        assertEq(total, 0.6e18);
        assertEq(token.balanceOf(alice) - oldBefore, 0.4e18);
        assertEq(next.balanceOf(alice) - newBefore, 0.2e18);
    }

    function test_ownerRecoversOldSurplusButNotOldReserve() public {
        lockAs(alice, COMMON_ID, 4e18); // pool: SEED + 4 old, 1.4 reserved
        _switch();
        uint256 free = pool.availableOf(token);
        assertEq(free, SEED + 4e18 - 1.4e18);

        vm.startPrank(owner);
        vm.expectRevert(abi.encodeWithSelector(VyraRewardPool.ExceedsSurplus.selector, free + 1, free));
        pool.withdrawSurplusOf(token, owner, free + 1);
        pool.withdrawSurplusOf(token, owner, free);
        vm.stopPrank();
        assertEq(token.balanceOf(address(pool)), 1.4e18);
        assertEq(pool.withdrawnOf(token), free);

        // the old lock still gets everything it was promised
        vm.warp(block.timestamp + 7 days);
        vm.prank(alice);
        locking.unlock(ids(COMMON_ID));
        assertEq(token.balanceOf(address(pool)), 0);
    }

    function test_emergencyReturnPaysInLockToken() public {
        lockAs(alice, COMMON_ID, 4e18);
        _switch();
        uint256 before = token.balanceOf(alice);
        vm.prank(owner);
        locking.emergencyReturn(ids(COMMON_ID));
        assertEq(token.balanceOf(alice) - before, 1.4e18);
        assertEq(pool.reservedOf(token), 0);
    }

    function test_depositGoesToCurrentToken() public {
        _switch();
        next.faucet(owner, 10e18);
        vm.startPrank(owner);
        next.approve(address(pool), 10e18);
        pool.deposit(10e18);
        vm.stopPrank();
        assertEq(pool.totalDeposited(), 10e18);
        assertEq(pool.depositedOf(token), SEED);
    }

    function test_switchBackRestoresStats() public {
        lockAs(alice, COMMON_ID, 4e18);
        _switch();
        vm.prank(owner);
        locking.setToken(token);
        assertEq(pool.totalReserved(), 1.4e18);
        assertEq(locking.totalLockPayments(), 4e18);
        // same token again: level-up works
        vm.prank(alice);
        locking.levelUp(COMMON_ID, 1, 12e18);
    }
}
