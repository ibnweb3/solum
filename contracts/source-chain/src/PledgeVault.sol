// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

/// @title PledgeVault
/// @notice "Platform A" — a generic, standalone pawn-shop-style lending vault on Ethereum
///         Sepolia. It has no relationship with Solum or Creditcoin whatsoever: it just locks a
///         deed as collateral for a loan and emits an event when it does. It is exactly the kind
///         of contract Solum's Amara scenario assumes exists somewhere else, unrelated to it.
/// @dev Demo simplification: `loanAmount` and payments are denominated in wei of the vault's own
///      native currency for simplicity — a real pawn shop would use a stablecoin. No interest,
///      no liquidation logic: this contract's only job is to be a genuine, independent second
///      lender whose pledge Solum can detect without ever calling into it.
contract PledgeVault is IERC721Receiver {
    IERC721 public immutable deed;

    struct Loan {
        uint256 deedId;
        address pledgor;
        uint256 loanAmount;
        uint256 repaid;
        bool released;
    }

    mapping(uint256 => Loan) public loans;
    uint256 public nextLoanId = 1;

    event CollateralPledged(
        uint256 indexed deedId, address indexed pledgor, uint256 loanAmount, uint256 timestamp
    );
    event PaymentMade(uint256 indexed loanId, uint256 amount, uint256 timestamp);
    event CollateralReleased(uint256 indexed loanId, uint256 indexed deedId, address indexed to);

    error NotDeedOwner();
    error LoanNotFound();
    error AlreadyReleased();

    constructor(address deedAddress) {
        deed = IERC721(deedAddress);
    }

    /// @notice Lock `deedId` as collateral for a loan of `loanAmount`.
    /// @dev Caller must have called `deed.approve(vault, deedId)` first. The vault takes custody
    ///      of the NFT for the lifetime of the loan, exactly like a physical pawn shop would hold
    ///      the item.
    function pledge(uint256 deedId, uint256 loanAmount) external returns (uint256 loanId) {
        if (deed.ownerOf(deedId) != msg.sender) revert NotDeedOwner();

        deed.safeTransferFrom(msg.sender, address(this), deedId);

        loanId = nextLoanId++;
        loans[loanId] = Loan({
            deedId: deedId,
            pledgor: msg.sender,
            loanAmount: loanAmount,
            repaid: 0,
            released: false
        });

        emit CollateralPledged(deedId, msg.sender, loanAmount, block.timestamp);
    }

    /// @notice Record a repayment against `loanId`. Anyone may call this on the pledgor's behalf;
    ///         this demo contract has no notion of who "should" be paying, only that a payment was
    ///         made — exactly the fact Solum's Attestcoin worker later attests.
    function makePayment(uint256 loanId) external payable {
        Loan storage loan = loans[loanId];
        if (loan.pledgor == address(0)) revert LoanNotFound();
        if (loan.released) revert AlreadyReleased();

        loan.repaid += msg.value;
        emit PaymentMade(loanId, msg.value, block.timestamp);
    }

    /// @notice Release the deed back to its pledgor once the loan is settled off-chain by the
    ///         vault operator. Demo-only: a real vault would gate this on `repaid >= loanAmount`.
    function release(uint256 loanId) external {
        Loan storage loan = loans[loanId];
        if (loan.pledgor == address(0)) revert LoanNotFound();
        if (loan.released) revert AlreadyReleased();

        loan.released = true;
        deed.safeTransferFrom(address(this), loan.pledgor, loan.deedId);

        emit CollateralReleased(loanId, loan.deedId, loan.pledgor);
    }

    function onERC721Received(address, address, uint256, bytes calldata)
        external
        pure
        override
        returns (bytes4)
    {
        return IERC721Receiver.onERC721Received.selector;
    }
}
