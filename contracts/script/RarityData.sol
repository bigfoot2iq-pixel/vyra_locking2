// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";

/// Loads the packed rarity map built by scripts/build-rarity.mjs (data/vyra-rarity.json).
abstract contract RarityData is Script {
    function rarityWords() internal view returns (uint256[] memory words) {
        string memory json = vm.readFile("./data/vyra-rarity.json");
        bytes32[] memory raw = vm.parseJsonBytes32Array(json, ".words");
        words = new uint256[](raw.length);
        for (uint256 i; i < raw.length; ++i) {
            words[i] = uint256(raw[i]);
        }
    }
}
