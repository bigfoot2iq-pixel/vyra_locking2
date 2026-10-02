// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";

/// Uploads the real collection map (data/vyra-rarity.json) and checks it token by token.
contract RealRarityTest is Base {
    function test_realCollectionMap() public {
        string memory json = vm.readFile("./data/vyra-rarity.json");
        bytes32[] memory raw = vm.parseJsonBytes32Array(json, ".words");
        uint256[] memory words = new uint256[](raw.length);
        for (uint256 i; i < raw.length; ++i) words[i] = uint256(raw[i]);
        assertEq(words.length, 18);

        vm.prank(owner);
        locking.setRarityWords(0, words);

        uint256[5] memory counts;
        for (uint256 id = 1; id <= 1111; ++id) counts[locking.baseTierOf(id)]++;
        assertEq(counts[COMMON], 545);
        assertEq(counts[UNCOMMON], 327);
        assertEq(counts[RARE], 164);
        assertEq(counts[EPIC], 55);
        assertEq(counts[LEGENDARY], 20);

        // spot checks against the metadata
        assertEq(locking.baseTierOf(1), LEGENDARY);
        assertEq(locking.baseTierOf(20), LEGENDARY);
        assertEq(locking.baseTierOf(21), RARE);
        assertEq(locking.baseTierOf(22), COMMON);
        assertEq(locking.baseTierOf(24), UNCOMMON);
        assertEq(locking.baseTierOf(36), EPIC);
    }
}
