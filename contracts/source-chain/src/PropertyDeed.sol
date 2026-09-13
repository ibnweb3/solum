// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title PropertyDeed
/// @notice A tokenized property title. Deliberately has no knowledge of Solum or Attestcoin —
///         it is "the other platform's" world: any lender that understands ERC-721 can accept
///         a deed as collateral, including one that has never heard of Creditcoin.
/// @dev Demo simplification: minting is owner-gated and stands in for a real notarization/
///      title-registry process, which is out of scope for this hackathon submission.
contract PropertyDeed is ERC721, Ownable {
    uint256 public nextDeedId = 1;

    constructor() ERC721("Property Deed", "DEED") Ownable(msg.sender) {}

    /// @notice Mint a new deed to `to`. Demo-only concierge mint, not a real title process.
    function mint(address to, string calldata /* uri */ ) external onlyOwner returns (uint256 deedId) {
        deedId = nextDeedId++;
        _safeMint(to, deedId);
    }
}
