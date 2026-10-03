// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Plain fixed-supply ERC-20 for testing the Keep on mainnet. The whole supply is
///         minted once to the deployer; no owner, no mint, no fees.
contract VyraTestToken is ERC20 {
    constructor(uint256 supply) ERC20("VYRA Test", "tVYRA") {
        _mint(msg.sender, supply);
    }
}
