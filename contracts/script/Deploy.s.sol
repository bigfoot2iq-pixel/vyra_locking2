// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {console} from "forge-std/Script.sol";
import {RarityData} from "./RarityData.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {VyraLocking} from "../src/VyraLocking.sol";
import {VyraRewardPool} from "../src/VyraRewardPool.sol";

/// @notice Production deploy. Env:
///   NFT_ADDRESS   VYRA collection
///   FINAL_OWNER   Safe multisig that will own both contracts
///   LOCK_RARITY   optional, true = freeze the rarity map forever right away (default false)
/// The deployer wires the contracts, uploads the collection's rarity map from
/// data/vyra-rarity.json, then proposes ownership to FINAL_OWNER.
/// The Safe must call acceptOwnership() on BOTH contracts to finish the handover.
/// Token and tiers/levels are then configured from the Safe, and the pool seeded.
contract Deploy is RarityData {
    function run() external returns (VyraLocking locking, VyraRewardPool pool) {
        address nft = vm.envAddress("NFT_ADDRESS");
        address finalOwner = vm.envAddress("FINAL_OWNER");

        vm.startBroadcast();
        address deployer = msg.sender;
        pool = new VyraRewardPool(deployer);
        locking = new VyraLocking(deployer, IERC721(nft), address(pool));
        pool.setLocking(address(locking));
        locking.setRarityWords(0, rarityWords());
        if (vm.envOr("LOCK_RARITY", false)) locking.lockRarity();
        pool.transferOwnership(finalOwner);
        locking.transferOwnership(finalOwner);
        vm.stopBroadcast();

        console.log("VyraRewardPool:", address(pool));
        console.log("VyraLocking:   ", address(locking));
        console.log("Pending owner: ", finalOwner, "(must acceptOwnership on both)");

        string memory k = "d";
        vm.serializeAddress(k, "locking", address(locking));
        vm.serializeAddress(k, "pool", address(pool));
        vm.serializeAddress(k, "nft", nft);
        string memory json = vm.serializeAddress(k, "token", address(0));
        vm.writeJson(json, string.concat("./deployments/", vm.toString(block.chainid), ".json"));
    }
}
