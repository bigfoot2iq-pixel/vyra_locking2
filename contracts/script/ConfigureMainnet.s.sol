// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {console} from "forge-std/Script.sol";
import {RarityData} from "./RarityData.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {VyraLocking} from "../src/VyraLocking.sol";
import {VyraRewardPool} from "../src/VyraRewardPool.sol";

/// @notice Finishes a Deploy.s.sol run when FINAL_OWNER is the deployer itself. Env:
///   LOCKING_ADDRESS, POOL_ADDRESS   from deployments/<chainId>.json
///   TOKEN_ADDRESS                   the reward token (one-time, permanent)
/// Accepts ownership of both contracts, sets the token and the tier/level table, checks the
/// on-chain rarity map word by word against data/vyra-rarity.json, then freezes it for good.
contract ConfigureMainnet is RarityData {
    function run() external {
        VyraLocking locking = VyraLocking(vm.envAddress("LOCKING_ADDRESS"));
        VyraRewardPool pool = VyraRewardPool(vm.envAddress("POOL_ADDRESS"));
        IERC20 token = IERC20(vm.envAddress("TOKEN_ADDRESS"));

        vm.startBroadcast();
        address me = msg.sender;

        if (pool.owner() != me) pool.acceptOwnership();
        if (locking.owner() != me) locking.acceptOwnership();

        if (address(locking.token()) == address(0)) locking.setToken(token);
        require(address(locking.token()) == address(token), "token mismatch");

        // Same table as the testnet. Token amounts, 18 decimals.
        VyraLocking.TierConfig[5] memory t;
        t[0] = _tier(500, [uint128(1), 11, 21, 31, 41], [uint128(10), 20, 30, 40, 50], [uint128(0), 3, 7, 12, 20]);
        t[1] = _tier(600, [uint128(3), 16, 31, 46, 61], [uint128(15), 30, 45, 60, 75], [uint128(0), 4, 9, 14, 22]);
        t[2] = _tier(700, [uint128(5), 21, 41, 61, 81], [uint128(20), 40, 60, 80, 100], [uint128(0), 5, 10, 16, 25]);
        t[3] = _tier(1000, [uint128(10), 41, 81, 121, 161], [uint128(40), 80, 120, 160, 200], [uint128(0), 8, 16, 25, 35]);
        t[4] = _tier(1400, [uint128(50), 101, 151, 201, 251], [uint128(100), 150, 200, 250, 300], [uint128(0), 10, 20, 32, 45]);
        locking.setTierConfigs(t);

        uint256[] memory expected = rarityWords();
        uint256[] memory onChain = locking.rarityWords(0, expected.length);
        for (uint256 i; i < expected.length; ++i) {
            require(onChain[i] == expected[i], "rarity word mismatch");
        }
        if (!locking.rarityLocked()) locking.lockRarity();

        vm.stopBroadcast();

        console.log("Owner:          ", me);
        console.log("Token:          ", address(locking.token()));
        console.log("Rarity words OK:", expected.length);
        console.log("Rarity frozen:  ", locking.rarityLocked());

        string memory path = string.concat("./deployments/", vm.toString(block.chainid), ".json");
        vm.writeJson(vm.toString(address(token)), path, ".token");
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
