// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {VyraLocking} from "../src/VyraLocking.sol";
import {VyraRewardPool} from "../src/VyraRewardPool.sol";
import {MockVyraNFT} from "../src/mocks/MockVyraNFT.sol";
import {MockToken} from "../src/mocks/MockToken.sol";

/// Shared deployment + sample config:
///   ids 1-2 Legendary, 3-4 Epic, 5-6 Rare, 9-10 Uncommon, everything else Common
///   Common 5%/day, levels 1-10 | 11-20 (+3) | 21-30 (+7) | 31-40 (+12) | 41-50 (+20)
abstract contract Base is Test {
    address owner = makeAddr("owner");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    MockVyraNFT nft;
    MockToken token;
    VyraRewardPool pool;
    VyraLocking locking;

    uint8 constant COMMON = 0;
    uint8 constant UNCOMMON = 1;
    uint8 constant RARE = 2;
    uint8 constant EPIC = 3;
    uint8 constant LEGENDARY = 4;

    uint256 constant LEGENDARY_ID = 1;
    uint256 constant EPIC_ID = 3;
    uint256 constant RARE_ID = 5;
    uint256 constant COMMON_ID = 7;
    uint256 constant COMMON_ID_2 = 8;
    uint256 constant UNCOMMON_ID = 9;

    uint256 constant SEED = 100e18;

    function setUp() public virtual {
        nft = new MockVyraNFT("ipfs://vyra/");
        token = new MockToken();
        pool = new VyraRewardPool(owner);
        locking = new VyraLocking(owner, IERC721(address(nft)), address(pool));

        vm.startPrank(owner);
        pool.setLocking(address(locking));
        locking.setToken(token);
        locking.setTierConfigs(defaultTiers());

        uint8[] memory tiers = new uint8[](11); // index = token id
        (tiers[1], tiers[2]) = (LEGENDARY, LEGENDARY);
        (tiers[3], tiers[4]) = (EPIC, EPIC);
        (tiers[5], tiers[6]) = (RARE, RARE);
        (tiers[9], tiers[10]) = (UNCOMMON, UNCOMMON);
        locking.setRarityWords(0, packTiers(tiers));
        vm.stopPrank();

        // the owner's one-time seed
        token.faucet(owner, SEED);
        vm.startPrank(owner);
        token.approve(address(pool), SEED);
        pool.deposit(SEED);
        vm.stopPrank();

        nft.mint(alice, 10); // ids 1..10
        token.faucet(alice, 10_000e18);
        vm.startPrank(alice);
        nft.setApprovalForAll(address(locking), true);
        token.approve(address(locking), type(uint256).max);
        vm.stopPrank();
    }

    function defaultTiers() internal pure returns (VyraLocking.TierConfig[5] memory t) {
        t[0] = tier(500, [uint128(1), 11, 21, 31, 41], [uint128(10), 20, 30, 40, 50], [uint128(0), 3, 7, 12, 20]);
        t[1] = tier(600, [uint128(3), 16, 31, 46, 61], [uint128(15), 30, 45, 60, 75], [uint128(0), 4, 9, 14, 22]);
        t[2] = tier(700, [uint128(5), 21, 41, 61, 81], [uint128(20), 40, 60, 80, 100], [uint128(0), 5, 10, 16, 25]);
        t[3] = tier(1000, [uint128(10), 41, 81, 121, 161], [uint128(40), 80, 120, 160, 200], [uint128(0), 8, 16, 25, 35]);
        t[4] = tier(1500, [uint128(50), 101, 151, 201, 251], [uint128(100), 150, 200, 250, 300], [uint128(0), 10, 20, 32, 45]);
    }

    /// Packs `tiers[id]` (index = token id) into 4-bit rarity words, 64 tokens per word.
    function packTiers(uint8[] memory tiers) internal pure returns (uint256[] memory words) {
        words = new uint256[]((tiers.length + 63) / 64);
        for (uint256 id; id < tiers.length; ++id) {
            words[id / 64] |= uint256(tiers[id]) << ((id % 64) * 4);
        }
    }

    /// Whole-token numbers → 18-decimals config.
    function tier(uint16 rate, uint128[5] memory mins, uint128[5] memory maxs, uint128[5] memory prices)
        internal
        pure
        returns (VyraLocking.TierConfig memory c)
    {
        c.dailyRateBps = rate;
        for (uint256 i; i < 5; ++i) {
            c.levels[i] = VyraLocking.Level({minAmount: mins[i] * 1e18, maxAmount: maxs[i] * 1e18, price: prices[i] * 1e18});
        }
    }

    function ids(uint256 a) internal pure returns (uint256[] memory r) {
        r = new uint256[](1);
        r[0] = a;
    }

    function ids(uint256 a, uint256 b) internal pure returns (uint256[] memory r) {
        r = new uint256[](2);
        (r[0], r[1]) = (a, b);
    }

    function lv(uint8 level) internal pure returns (uint8[] memory r) {
        r = new uint8[](1);
        r[0] = level;
    }

    function lockAs(address who, uint256 id, uint256 amount) internal {
        lockAs(who, id, amount, 0);
    }

    function lockAs(address who, uint256 id, uint256 amount, uint8 level) internal {
        vm.prank(who);
        locking.lock(ids(id), ids(amount), lv(level));
    }
}
