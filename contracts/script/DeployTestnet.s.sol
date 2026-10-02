// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {console} from "forge-std/Script.sol";
import {RarityData} from "./RarityData.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {VyraLocking} from "../src/VyraLocking.sol";
import {VyraRewardPool} from "../src/VyraRewardPool.sol";
import {MockVyraNFT} from "../src/mocks/MockVyraNFT.sol";
import {MockToken} from "../src/mocks/MockToken.sol";

/// @notice Testnet / local setup: mocks, sample tiers + levels, the REAL collection rarity map,
///         a 100-token pool seed, and one guardian of each rarity minted to the deployer.
///         Deployer stays owner.
///   Optional env: NFT_BASE_URI
contract DeployTestnet is RarityData {
    function run() external {
        string memory baseURI = vm.envOr("NFT_BASE_URI", string(""));

        vm.startBroadcast();
        address deployer = msg.sender;

        MockVyraNFT nft = new MockVyraNFT(baseURI);
        MockToken token = new MockToken();
        VyraRewardPool pool = new VyraRewardPool(deployer);
        VyraLocking locking = new VyraLocking(deployer, IERC721(address(nft)), address(pool));
        pool.setLocking(address(locking));
        locking.setToken(token);

        // Example with 1 token ≈ 1 USD. Owner sets token amounts, not USD.
        VyraLocking.TierConfig[5] memory t;
        t[0] = _tier(500, [uint128(1), 11, 21, 31, 41], [uint128(10), 20, 30, 40, 50], [uint128(0), 3, 7, 12, 20]);
        t[1] = _tier(600, [uint128(3), 16, 31, 46, 61], [uint128(15), 30, 45, 60, 75], [uint128(0), 4, 9, 14, 22]);
        t[2] = _tier(700, [uint128(5), 21, 41, 61, 81], [uint128(20), 40, 60, 80, 100], [uint128(0), 5, 10, 16, 25]);
        t[3] = _tier(1000, [uint128(10), 41, 81, 121, 161], [uint128(40), 80, 120, 160, 200], [uint128(0), 8, 16, 25, 35]);
        t[4] = _tier(1400, [uint128(50), 101, 151, 201, 251], [uint128(100), 150, 200, 250, 300], [uint128(0), 10, 20, 32, 45]);
        locking.setTierConfigs(t);
        locking.setRarityWords(0, rarityWords());

        token.faucet(deployer, 1_000_000e18);
        token.approve(address(pool), 100e18);
        pool.deposit(100e18); // the owner's one-time seed
        // one of each rarity per the real map: Legendary 1-2, Epic 36, Rare 21, Uncommon 24, Common 22-23
        uint256[] memory demo = new uint256[](7);
        (demo[0], demo[1], demo[2], demo[3], demo[4], demo[5], demo[6]) = (1, 2, 36, 21, 24, 22, 23);
        nft.mintIds(deployer, demo);
        vm.stopBroadcast();

        console.log("MockVyraNFT:   ", address(nft));
        console.log("MockToken:     ", address(token));
        console.log("VyraRewardPool:", address(pool));
        console.log("VyraLocking:   ", address(locking));

        string memory k = "d";
        vm.serializeAddress(k, "locking", address(locking));
        vm.serializeAddress(k, "pool", address(pool));
        vm.serializeAddress(k, "nft", address(nft));
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
