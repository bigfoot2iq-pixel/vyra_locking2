// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {VyraLocking} from "../src/VyraLocking.sol";
import {VyraRewardPool} from "../src/VyraRewardPool.sol";
import {MockVyraNFT} from "../src/mocks/MockVyraNFT.sol";
import {MockToken} from "../src/mocks/MockToken.sol";
import {Base} from "./Base.t.sol";

/// Random holder/owner actions against the live contracts. Failed calls are fine (bad inputs);
/// what matters is that the invariants hold after every sequence.
contract Handler is Test {
    VyraLocking locking;
    VyraRewardPool pool;
    MockVyraNFT nft;
    MockToken token;
    address owner;
    address[3] actors;
    /// ghost counters: successful calls, to prove the fuzzer exercises real paths
    uint256 public locks;
    uint256 public renews;
    uint256 public unlocks;
    uint256 public claims;
    uint256 public paidLevels;
    uint256 public levelUps;

    constructor(VyraLocking l, VyraRewardPool p, MockVyraNFT n, MockToken t, address o, address alice) {
        (locking, pool, nft, token, owner) = (l, p, n, t, o);
        token.faucet(alice, 1_000_000e18);
        for (uint256 i; i < 3; ++i) {
            actors[i] = address(uint160(0xA11CE + i));
            nft.mint(actors[i], 6);
            token.faucet(actors[i], 1_000_000e18);
            vm.startPrank(actors[i]);
            nft.setApprovalForAll(address(locking), true);
            token.approve(address(locking), type(uint256).max);
            vm.stopPrank();
        }
    }

    function _one(uint256 id) internal pure returns (uint256[] memory r) {
        r = new uint256[](1);
        r[0] = id;
    }

    /// ids 1-10 (alice, every tier) and 11-28 (handler actors, Common)
    function _id(uint256 seed) internal pure returns (uint256) {
        return bound(seed, 1, 28);
    }

    /// A random level and an amount inside that level's range for the token's tier.
    function _pick(uint256 id, uint256 seed) internal view returns (uint8 level, uint256 amount) {
        level = uint8(seed % 5);
        VyraLocking.Level memory l = locking.tierConfig(locking.baseTierOf(id)).levels[level];
        amount = bound(seed >> 8, l.minAmount, l.maxAmount);
    }

    function _lv(uint8 level) internal pure returns (uint8[] memory r) {
        r = new uint8[](1);
        r[0] = level;
    }

    function _lockOwner(uint256 id) internal view returns (address) {
        return locking.lockOf(id).owner;
    }

    function lock(uint256 idSeed, uint256 amountSeed) external {
        uint256 id = _id(idSeed);
        address holder = nft.ownerOf(id);
        if (holder == address(locking)) return;
        (uint8 level, uint256 amount) = _pick(id, amountSeed);
        vm.prank(holder);
        try locking.lock(_one(id), _one(amount), _lv(level)) {
            if (level > 0) ++paidLevels;
            ++locks;
        } catch {}
    }

    function renew(uint256 idSeed, uint256 amountSeed) external {
        uint256 id = _id(idSeed);
        address holder = _lockOwner(id);
        if (holder == address(0)) return;
        (uint8 level, uint256 amount) = _pick(id, amountSeed);
        vm.prank(holder);
        try locking.renew(_one(id), _one(amount), _lv(level)) {
            if (level > 0) ++paidLevels;
            ++renews;
        } catch {}
    }

    function unlock(uint256 idSeed) external {
        uint256 id = _id(idSeed);
        address holder = _lockOwner(id);
        if (holder == address(0)) return;
        vm.prank(holder);
        try locking.unlock(_one(id)) {
            ++unlocks;
        } catch {}
    }

    function claim(uint256 idSeed) external {
        uint256 id = _id(idSeed);
        address holder = _lockOwner(id);
        if (holder == address(0)) return;
        vm.prank(holder);
        try pool.claim(_one(id)) {
            ++claims;
        } catch {}
    }

    function levelUp(uint256 idSeed, uint256 seed) external {
        // start at a random id and take the first running lock that can still level up
        uint256 id;
        address holder;
        for (uint256 k; k < 28; ++k) {
            uint256 cand = (idSeed + k) % 28 + 1;
            address o = _lockOwner(cand);
            if (o != address(0) && block.timestamp < locking.endOf(cand) && locking.lockOf(cand).level < 4) {
                (id, holder) = (cand, o);
                break;
            }
        }
        if (holder == address(0)) return;
        uint8 current = locking.lockOf(id).level;
        uint8 level = uint8(bound(seed, current + 1, 4));
        VyraLocking.Level memory l = locking.tierConfig(locking.baseTierOf(id)).levels[level];
        uint256 locked = locking.lockOf(id).amount;
        uint256 lo = l.minAmount > locked ? l.minAmount : locked;
        if (lo > l.maxAmount) return;
        uint256 amount = bound(seed >> 8, lo, l.maxAmount);
        vm.prank(holder);
        try locking.levelUp(id, level, amount) {
            ++levelUps;
        } catch {}
    }

    function ownerWithdraw(uint256 amount) external {
        uint256 free = pool.available();
        if (free == 0) return;
        vm.prank(owner);
        pool.withdrawSurplus(owner, bound(amount, 1, free));
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1 hours, 4 days));
    }
}

contract PoolInvariants is Base {
    Handler handler;

    function setUp() public override {
        super.setUp();
        handler = new Handler(locking, pool, nft, token, owner, alice); // mints ids 11..28
        targetContract(address(handler));
    }

    /// Sanity: across a whole run, the fuzzer really locks (including paid levels).
    function afterInvariant() external view {
        assertGt(handler.locks(), 0);
        assertGt(handler.paidLevels(), 0);
        assertGt(handler.levelUps(), 0);

    }

    /// The pool always holds at least everything it has promised.
    function invariant_poolCoversReserved() public view {
        assertGe(token.balanceOf(address(pool)), pool.totalReserved());
    }

    /// The locking contract never keeps tokens.
    function invariant_lockingHoldsNoTokens() public view {
        assertEq(token.balanceOf(address(locking)), 0);
    }

    /// Money in = money out + money held.
    function invariant_poolAccounting() public view {
        uint256 inflow = pool.totalDeposited() + locking.totalLockPayments() + locking.totalLevelPayments();
        uint256 outflow = pool.totalPaidOut() + pool.totalWithdrawn();
        assertEq(token.balanceOf(address(pool)), inflow - outflow);
    }
}
