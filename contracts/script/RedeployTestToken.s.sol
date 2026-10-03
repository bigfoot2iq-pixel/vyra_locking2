// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {console} from "forge-std/Script.sol";
import {RarityData} from "./RarityData.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {VyraLocking} from "../src/VyraLocking.sol";
import {VyraRewardPool} from "../src/VyraRewardPool.sol";
import {VyraTestToken} from "../src/test-token/VyraTestToken.sol";

/// @notice Full Keep deployment on a test token, owned by the deployer. Env:
///   NFT_ADDRESS   VYRA collection
///   TOKEN_ADDRESS optional existing ERC-20 to use (18 decimals, no transfer fees); the deployer
///                 must hold the seed. Unset: deploys tVYRA with 1B to the deployer.
///   SEED          optional pool seed in whole tokens (default 100000)
/// Deploys pool and locking (and tVYRA if needed), wires them, uploads the rarity map,
/// checks it word by word against data/vyra-rarity.json, freezes it, sets the token and the
/// tier table, and seeds the pool. The collection owner must still allow-list the new locking
/// contract on OpenSea's transfer validator.
contract RedeployTestToken is RarityData {
    function run() external {
        address nft = vm.envAddress("NFT_ADDRESS");
        uint256 seed = vm.envOr("SEED", uint256(100_000)) * 1e18;

        vm.startBroadcast();
        address me = msg.sender;
        address existing = vm.envOr("TOKEN_ADDRESS", address(0));
        IERC20 token = existing != address(0) ? IERC20(existing) : new VyraTestToken(1_000_000_000e18);
        VyraRewardPool pool = new VyraRewardPool(me);
        VyraLocking locking = new VyraLocking(me, IERC721(nft), address(pool));
        pool.setLocking(address(locking));
        locking.setToken(token);

        uint256[] memory words = rarityWords();
        locking.setRarityWords(0, words);
        uint256[] memory onChain = locking.rarityWords(0, words.length);
        for (uint256 i; i < words.length; ++i) {
            require(onChain[i] == words[i], "rarity word mismatch");
        }
        locking.lockRarity();

        VyraLocking.TierConfig[5] memory t;
        t[0] = _tier(500, [uint128(1), 11, 21, 31, 41], [uint128(10), 20, 30, 40, 50], [uint128(0), 3, 7, 12, 20]);
        t[1] = _tier(600, [uint128(3), 16, 31, 46, 61], [uint128(15), 30, 45, 60, 75], [uint128(0), 4, 9, 14, 22]);
        t[2] = _tier(700, [uint128(5), 21, 41, 61, 81], [uint128(20), 40, 60, 80, 100], [uint128(0), 5, 10, 16, 25]);
        t[3] = _tier(1000, [uint128(10), 41, 81, 121, 161], [uint128(40), 80, 120, 160, 200], [uint128(0), 8, 16, 25, 35]);
        t[4] = _tier(1400, [uint128(50), 101, 151, 201, 251], [uint128(100), 150, 200, 250, 300], [uint128(0), 10, 20, 32, 45]);
        locking.setTierConfigs(t);

        if (seed > 0) {
            token.approve(address(pool), seed);
            pool.deposit(seed);
        }
        vm.stopBroadcast();

        console.log("Token:         ", address(token));
        console.log("VyraRewardPool:", address(pool));
        console.log("VyraLocking:   ", address(locking));
        console.log("Owner:         ", me);

        string memory k = "d";
        vm.serializeAddress(k, "locking", address(locking));
        vm.serializeAddress(k, "pool", address(pool));
        vm.serializeAddress(k, "nft", nft);
        string memory json = vm.serializeAddress(k, "token", address(token));
        vm.writeJson(json, string.concat("./deployments/", vm.toString(block.chainid), ".json"));
    }

    function _tier(uint16 rate, uint128[5] memory mins, uint128[5] memory maxs, uint128[5] memory prices)
        internal
        pure
        returns (VyraLocking.TierConfig memory c)
    {
        c.dailyRateBps = rate;
        for (uint256 i; i < 5; ++i) {
            c.levels[i] = VyraLocking.Level({minAmount: mins[i] * 1e18, maxAmount: maxs[i] * 1e18, price: prices[i] * 1e18});
        }
    }
}
