// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {VyraLocking} from "../src/VyraLocking.sol";
import {VyraRewardPool} from "../src/VyraRewardPool.sol";

interface ITransferValidator {
    function isAccountWhitelistedByCollection(address collection, address account) external view returns (bool);
    function addAccountToWhitelist(uint120 id, address account) external;
}

/// @notice Runs against the live Ink deployment: real VYRA NFT (with OpenSea's transfer
///         validator), the TESTEORM test token, real holders. Skipped unless a fork RPC is given:
///   FORK_URL=https://rpc-gel.inkonchain.com forge test --match-contract MainnetFork -vv
contract MainnetForkTest is Test {
    VyraLocking constant LOCKING = VyraLocking(0x69b02d133aBA37f2AE61BF1fd6C6B894e2FF073d);
    VyraRewardPool constant POOL = VyraRewardPool(0xE2621518d2dEe82E554ef02f1550FfA916e6b7b6);
    IERC721 constant NFT = IERC721(0x9045306bA97EfE8B0DF46817eAD4fb099aAe1aFE);
    IERC20 constant TOKEN = IERC20(0x472B75e6E91700694d2F44d0824e725C35710f57);
    address constant OWNER = 0x16cCaC44ab58Da9Deca87424831B9929840c78b0;
    ITransferValidator constant VALIDATOR = ITransferValidator(0xA000027A9B2802E1ddf7000061001e5c005A0000);
    address constant COLLECTION_OWNER = 0xFFABc67Fe0737CD4fA32eA4Cac951eEedaFFc2cC;
    uint120 constant COLLECTION_LIST = 97;

    // Real holders and guardians they hold on Ink (tiers from the frozen rarity map).
    address constant ALICE = 0xAa06Db40EE9FFA818eE3149CE7D07a89573289dE; // 1087 Common, 1081 Uncommon
    address constant BOB = 0xFFABc67Fe0737CD4fA32eA4Cac951eEedaFFc2cC; // 2, 3 Legendary
    address constant STRANGER = address(0xBEEF);
    uint256 constant COMMON = 1087;
    uint256 constant UNCOMMON = 1081;
    uint256 constant LEGEND = 2;
    uint16 liveDurationDays;

    function setUp() public {
        string memory url = vm.envOr("FORK_URL", string(""));
        if (bytes(url).length == 0) vm.skip(true);
        vm.createSelectFork(url);
        // Until the collection owner allow-lists this locking contract on OpenSea's validator,
        // simulate that one transaction so the rest of the suite can run.
        if (!VALIDATOR.isAccountWhitelistedByCollection(address(NFT), address(LOCKING))) {
            vm.prank(COLLECTION_OWNER);
            VALIDATOR.addAccountToWhitelist(COLLECTION_LIST, address(LOCKING));
        }
        _fund(ALICE);
        _fund(BOB);
        // the live Keep runs 1-day periods; the suite below checks multi-day accrual on 7
        liveDurationDays = LOCKING.durationDays();
        vm.prank(OWNER);
        LOCKING.setDurationDays(7);
    }

    function _fund(address who) internal {
        deal(address(TOKEN), who, 10_000e18);
        vm.startPrank(who);
        NFT.setApprovalForAll(address(LOCKING), true);
        TOKEN.approve(address(LOCKING), type(uint256).max);
        vm.stopPrank();
    }

    function _lock(address who, uint256 id, uint256 amount, uint8 level) internal {
        uint256[] memory ids = new uint256[](1);
        uint256[] memory amounts = new uint256[](1);
        uint8[] memory levels = new uint8[](1);
        (ids[0], amounts[0], levels[0]) = (id, amount, level);
        vm.prank(who);
        LOCKING.lock(ids, amounts, levels);
    }

    function _one(uint256 id) internal pure returns (uint256[] memory a) {
        a = new uint256[](1);
        a[0] = id;
    }

    // ---------------------------------------------------------------- deployment state

    function test_deploymentIsConfigured() public view {
        assertEq(LOCKING.owner(), OWNER);
        assertEq(POOL.owner(), OWNER);
        assertEq(address(LOCKING.token()), address(TOKEN));
        assertEq(address(POOL.locking()), address(LOCKING));
        assertTrue(LOCKING.rarityLocked());
        assertEq(liveDurationDays, 1);
        assertEq(LOCKING.baseTierOf(LEGEND), 4);
        assertEq(LOCKING.baseTierOf(COMMON), 0);
        assertEq(LOCKING.baseTierOf(UNCOMMON), 1);
    }

    // ---------------------------------------------------------------- lock (OpenSea validator)

    function test_lockMovesNftThroughOpenSeaValidator() public {
        uint256 poolBefore = TOKEN.balanceOf(address(POOL));
        _lock(ALICE, COMMON, 5e18, 0);
        assertEq(NFT.ownerOf(COMMON), address(LOCKING), "NFT held by locking");
        assertEq(TOKEN.balanceOf(address(POOL)) - poolBefore, 5e18, "payment in pool");
        assertEq(TOKEN.balanceOf(address(LOCKING)), 0, "locking never holds tokens");
        assertEq(LOCKING.lockedTokensOf(ALICE).length, 1);
    }

    function test_batchLockAcrossTiersAndLevels() public {
        uint256[] memory ids = new uint256[](2);
        uint256[] memory amounts = new uint256[](2);
        uint8[] memory levels = new uint8[](2);
        (ids[0], amounts[0], levels[0]) = (COMMON, 15e18, 1); // Common L2: 11-20, fee 3
        (ids[1], amounts[1], levels[1]) = (UNCOMMON, 3e18, 0); // Uncommon L1: 3-15, free
        uint256 poolBefore = TOKEN.balanceOf(address(POOL));
        vm.prank(ALICE);
        LOCKING.lock(ids, amounts, levels);
        assertEq(TOKEN.balanceOf(address(POOL)) - poolBefore, 15e18 + 3e18 + 3e18, "amounts + L2 fee");
        assertEq(LOCKING.lockOf(COMMON).level, 1);
        assertEq(LOCKING.lockOf(UNCOMMON).level, 0);
    }

    function test_lockRejectsBadInput() public {
        uint256[] memory ids = _one(COMMON);
        uint256[] memory amounts = _one(11e18); // above Common L1 max of 10
        uint8[] memory levels = new uint8[](1);
        vm.prank(ALICE);
        vm.expectRevert(abi.encodeWithSelector(VyraLocking.AmountOutOfRange.selector, COMMON, 11e18, 1e18, 10e18));
        LOCKING.lock(ids, amounts, levels);

        // someone else's guardian
        vm.prank(STRANGER);
        vm.expectRevert();
        LOCKING.lock(_one(LEGEND), _one(60e18), levels);

        // already locked
        _lock(ALICE, COMMON, 5e18, 0);
        vm.prank(ALICE);
        vm.expectRevert();
        LOCKING.lock(_one(COMMON), _one(5e18), levels);
    }

    // ---------------------------------------------------------------- rewards

    function test_claimPaysExactDailyRewardsOnce() public {
        _lock(BOB, LEGEND, 100e18, 0); // Legendary 14%/day
        vm.warp(block.timestamp + 2 days + 23 hours);
        assertEq(POOL.pendingOf(LEGEND), 28e18, "2 full days only");

        uint256 before = TOKEN.balanceOf(BOB);
        vm.prank(BOB);
        POOL.claim(_one(LEGEND));
        assertEq(TOKEN.balanceOf(BOB) - before, 28e18);
        assertEq(POOL.pendingOf(LEGEND), 0);

        vm.prank(BOB);
        POOL.claim(_one(LEGEND)); // nothing new: no double pay
        assertEq(TOKEN.balanceOf(BOB) - before, 28e18);

        vm.warp(block.timestamp + 30 days); // capped at the 7-day period
        assertEq(POOL.pendingOf(LEGEND), 5 * 14e18);
    }

    function test_strangerCannotClaimOrUnlockOrLevelUp() public {
        _lock(ALICE, COMMON, 5e18, 0);
        vm.warp(block.timestamp + 8 days);
        vm.startPrank(STRANGER);
        vm.expectRevert(abi.encodeWithSelector(VyraRewardPool.NotLockOwner.selector, COMMON));
        POOL.claim(_one(COMMON));
        vm.expectRevert();
        LOCKING.unlock(_one(COMMON));
        vm.expectRevert();
        LOCKING.levelUp(COMMON, 1, 15e18);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- level up

    function test_levelUpChargesDifferenceAndKeepsEndDate() public {
        _lock(ALICE, COMMON, 5e18, 0);
        uint40 start = LOCKING.lockOf(COMMON).start;
        vm.warp(block.timestamp + 3 days + 1 hours);

        uint256 poolBefore = TOKEN.balanceOf(address(POOL));
        uint256 aliceBefore = TOKEN.balanceOf(ALICE);
        vm.prank(ALICE);
        LOCKING.levelUp(COMMON, 1, 15e18); // L1 -> L2: fee 3 + top-up 10, pays 3 days earned first

        VyraLocking.Lock memory l = LOCKING.lockOf(COMMON);
        assertEq(l.level, 1);
        assertEq(l.amount, 15e18);
        assertEq(l.start, start, "end date unchanged");
        assertEq(aliceBefore - TOKEN.balanceOf(ALICE), 13e18 - 0.75e18, "paid 13, received 0.75 earned");
        assertEq(TOKEN.balanceOf(address(POOL)) - poolBefore, 13e18 - 0.75e18);

        vm.warp(start + 7 days);
        assertEq(POOL.pendingOf(COMMON), 4 * 0.75e18, "remaining 4 days at 15 VR x 5%");
    }

    function test_levelUpRejectsInvalidMoves() public {
        _lock(ALICE, COMMON, 15e18, 1);
        vm.startPrank(ALICE);
        vm.expectRevert(abi.encodeWithSelector(VyraLocking.InvalidLevel.selector, 0));
        LOCKING.levelUp(COMMON, 0, 15e18); // down
        vm.expectRevert(abi.encodeWithSelector(VyraLocking.InvalidLevel.selector, 5));
        LOCKING.levelUp(COMMON, 5, 50e18); // past top
        vm.expectRevert();
        LOCKING.levelUp(COMMON, 2, 20e18); // below L3 min of 21
        vm.warp(block.timestamp + 7 days);
        vm.expectRevert(abi.encodeWithSelector(VyraLocking.LockEnded.selector, COMMON));
        LOCKING.levelUp(COMMON, 2, 25e18); // after end
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- end of lock

    function test_unlockOnlyAfterEndAndPaysRemainder() public {
        _lock(ALICE, UNCOMMON, 10e18, 0); // 6%/day
        vm.prank(ALICE);
        vm.expectRevert();
        LOCKING.unlock(_one(UNCOMMON));

        vm.warp(block.timestamp + 7 days);
        uint256 before = TOKEN.balanceOf(ALICE);
        vm.prank(ALICE);
        LOCKING.unlock(_one(UNCOMMON));
        assertEq(NFT.ownerOf(UNCOMMON), ALICE, "guardian back home");
        assertEq(TOKEN.balanceOf(ALICE) - before, 7 * 0.6e18, "all 7 days paid on unlock");
        assertEq(LOCKING.lockedTokensOf(ALICE).length, 0);
    }

    function test_emergencyReturnSendsGuardiansHomeWithFullReward() public {
        _lock(ALICE, UNCOMMON, 10e18, 0); // 6%/day
        _lock(BOB, LEGEND, 50e18, 0); // 14%/day
        vm.warp(block.timestamp + 2 days);
        vm.prank(OWNER);
        LOCKING.pause();

        uint256 aliceBefore = TOKEN.balanceOf(ALICE);
        uint256 bobBefore = TOKEN.balanceOf(BOB);
        vm.prank(OWNER);
        LOCKING.emergencyReturnAll(10);
        assertEq(NFT.ownerOf(UNCOMMON), ALICE, "alice's guardian back home");
        assertEq(NFT.ownerOf(LEGEND), BOB, "bob's guardian back home");
        assertEq(TOKEN.balanceOf(ALICE) - aliceBefore, 7 * 0.6e18, "full period paid");
        assertEq(TOKEN.balanceOf(BOB) - bobBefore, 7 * 7e18, "full period paid");
        assertEq(LOCKING.allLockedCount(), 0);
        assertEq(POOL.totalReserved(), 0);
    }

    function test_renewAtHigherLevelKeepsNftInPlace() public {
        _lock(ALICE, COMMON, 5e18, 0);
        vm.warp(block.timestamp + 7 days);
        uint256 before = TOKEN.balanceOf(ALICE);
        uint8[] memory levels = new uint8[](1);
        levels[0] = 2; // L3: 21-30, fee 7
        vm.prank(ALICE);
        LOCKING.renew(_one(COMMON), _one(25e18), levels);
        assertEq(NFT.ownerOf(COMMON), address(LOCKING));
        assertEq(LOCKING.lockOf(COMMON).level, 2);
        assertEq(before - TOKEN.balanceOf(ALICE), 25e18 + 7e18 - 7 * 0.25e18, "new payment minus old rewards");
    }

    function test_unlockedGuardianCanStillBeTransferredByHolder() public {
        _lock(ALICE, COMMON, 5e18, 0);
        vm.warp(block.timestamp + 7 days);
        vm.prank(ALICE);
        LOCKING.unlock(_one(COMMON));
        vm.prank(ALICE);
        NFT.transferFrom(ALICE, STRANGER, COMMON);
        assertEq(NFT.ownerOf(COMMON), STRANGER);
    }

    // ---------------------------------------------------------------- pause & admin

    function test_pauseBlocksNewLocksButNotClaimOrUnlock() public {
        _lock(ALICE, COMMON, 5e18, 0);
        vm.prank(OWNER);
        LOCKING.pause();

        vm.expectRevert(Pausable.EnforcedPause.selector);
        _lock(ALICE, UNCOMMON, 3e18, 0);
        vm.prank(ALICE);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        LOCKING.levelUp(COMMON, 1, 15e18);

        vm.warp(block.timestamp + 7 days);
        vm.startPrank(ALICE);
        POOL.claim(_one(COMMON));
        LOCKING.unlock(_one(COMMON));
        vm.stopPrank();
        assertEq(NFT.ownerOf(COMMON), ALICE);
    }

    function test_onlyOwnerCanAdmin() public {
        VyraLocking.TierConfig[5] memory t;
        vm.startPrank(STRANGER);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, STRANGER));
        LOCKING.pause();
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, STRANGER));
        LOCKING.setTierConfigs(t);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, STRANGER));
        POOL.withdrawSurplus(STRANGER, 1);
        vm.stopPrank();
    }

    function test_rarityMapIsFrozen() public {
        uint256[] memory words = new uint256[](1);
        vm.prank(OWNER);
        vm.expectRevert(VyraLocking.RarityIsLocked.selector);
        LOCKING.setRarityWords(0, words);
    }

    function test_ownerCannotWithdrawReservedRewards() public {
        deal(address(TOKEN), OWNER, 1_000e18);
        vm.startPrank(OWNER);
        TOKEN.approve(address(POOL), 1_000e18);
        POOL.deposit(1_000e18);
        vm.stopPrank();

        _lock(BOB, LEGEND, 100e18, 0); // reserves 98 VR for Bob

        uint256 free = POOL.available();
        vm.prank(OWNER);
        vm.expectRevert();
        POOL.withdrawSurplus(OWNER, free + 1);
        vm.prank(OWNER);
        POOL.withdrawSurplus(OWNER, free); // drain every free token

        vm.warp(block.timestamp + 7 days);
        uint256 before = TOKEN.balanceOf(BOB);
        vm.prank(BOB);
        LOCKING.unlock(_one(LEGEND));
        assertEq(TOKEN.balanceOf(BOB) - before, 98e18, "Bob still paid in full");
    }
}
