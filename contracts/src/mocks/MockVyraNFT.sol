// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";

/// @notice Testnet stand-in for the VYRA collection. Anyone can mint; ids start at 1.
contract MockVyraNFT is ERC721Enumerable {
    uint256 public constant MAX_SUPPLY = 1111;
    uint256 public nextId = 1;
    string private _base;

    constructor(string memory baseURI_) ERC721("VYRA (Test)", "VYRA") {
        _base = baseURI_;
    }

    function mint(address to, uint256 quantity) external {
        for (uint256 i; i < quantity; ++i) {
            require(nextId <= MAX_SUPPLY, "sold out");
            _mint(to, nextId++);
        }
    }

    /// @notice Mint chosen ids (lets demos pick guardians of every rarity).
    function mintIds(address to, uint256[] calldata ids) external {
        for (uint256 i; i < ids.length; ++i) {
            require(ids[i] >= 1 && ids[i] <= MAX_SUPPLY, "bad id");
            _mint(to, ids[i]);
        }
    }

    function _baseURI() internal view override returns (string memory) {
        return _base;
    }
}
