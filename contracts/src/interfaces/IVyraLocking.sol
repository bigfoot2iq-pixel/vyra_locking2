// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IVyraLocking {
    /// @dev Snapshot of an active lock. Every value is frozen at lock/renew time,
    ///      so later config changes never affect a running period.
    struct Lock {
        address owner;
        uint8 tier; // rarity tier of the NFT (0 Common, 1 Uncommon, 2 Rare, 3 Epic, 4 Legendary)
        uint8 level; // level used for this period (0-based; UI shows level + 1)
        uint16 rateBps; // daily reward, in basis points of `amount`
        uint16 durationDays;
        uint40 start;
        uint64 lockId; // unique per lock/renew; keys the pool's claim ledger
        uint128 amount; // tokens paid into the pool for this period
    }

    function token() external view returns (IERC20);
    function lockOf(uint256 tokenId) external view returns (Lock memory);
}
