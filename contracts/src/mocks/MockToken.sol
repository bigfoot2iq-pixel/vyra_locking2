// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

/// @notice Testnet stake/reward token with burn() and a public faucet.
contract MockToken is ERC20Burnable {
    constructor() ERC20("Mock INK Token", "mINK") {}

    function faucet(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @notice Token without burn(), to exercise the 0x…dEaD path.
contract MockTokenNoBurn is ERC20 {
    constructor() ERC20("Mock No-Burn", "mNB") {}

    function faucet(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
