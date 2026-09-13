// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ASCBase} from "@gluwa/asc-contracts/contracts/readability/ASCBase.sol";
import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";

/// @title SolumASC
/// @notice Cross-chain mortgage underwriting on Creditcoin. Before approving a mortgage against a
///         tokenized property deed, checks — via the Attestcoin Protocol, with no oracle, no
///         partnership, no shared database — whether that same deed has already been pledged as
///         collateral on an unrelated platform (PledgeVault, on Ethereum Sepolia).
/// @dev Readability-only ASC: inherits {ASCBase}, whose `execute(...)` verifies inclusion via the
///      Block Prover precompile (`0x0FD2`) and dedupes by query id before calling
///      {_processAndEmitEvent}. See docs/attestcoin-integration.md for the full flow.
contract SolumASC is ASCBase, Ownable {
    enum SolumActions {
        PledgeAttested // 0
    }

    enum ApplicationStatus {
        None,
        Approved,
        Rejected
    }

    struct Mortgage {
        uint256 deedId;
        uint256 propertyValueUsd;
        uint256 loanAmount;
        ApplicationStatus status;
        uint256 createdAt;
        uint256 amountRepaid;
    }

    error InvalidAction(uint8 action);

    // CollateralPledged(uint256,address,uint256,uint256) — event signature computed with
    // `cast keccak "CollateralPledged(uint256,address,uint256,uint256)"`, matching PledgeVault.sol.
    bytes32 public constant PLEDGE_EVENT_SIGNATURE =
        0x37cd789f2f6be5820fd856316f913b8b291a4b2fbbe20de8b05fe75b3fba5db6;

    /// @notice The one Sepolia contract whose `CollateralPledged` events are trusted. Without this
    ///         binding, anyone could deploy a contract that emits a lookalike event for an
    ///         arbitrary deed id and grief a clean deed into looking pledged elsewhere.
    address public pledgeVault;

    mapping(uint256 => bool) public deedIsPledgedElsewhere;
    mapping(uint256 => address) public pledgorOfDeed;
    mapping(uint256 => uint256) public pledgedLoanAmount;

    mapping(uint256 => Mortgage) public applications;
    uint256 public nextApplicationId = 1;

    event PledgeVaultRegistered(address indexed pledgeVault);
    event PledgeAttested(uint256 indexed deedId, address indexed pledgor, uint256 loanAmount, bytes32 queryId);
    event MortgageApproved(uint256 indexed applicationId, uint256 indexed deedId, uint256 loanAmount);
    event MortgageRejected(
        uint256 indexed applicationId,
        uint256 indexed deedId,
        address conflictingPledgor,
        uint256 conflictingLoanAmount
    );

    constructor() Ownable(msg.sender) {}

    /// @notice One-time (or updatable) admin step binding the trusted Sepolia PledgeVault address.
    function registerPledgeVault(address vault) external onlyOwner {
        require(vault != address(0), "Pledge vault cannot be the zero address");
        pledgeVault = vault;
        emit PledgeVaultRegistered(vault);
    }

    /// @notice Apply for a mortgage against `deedId`. Synchronous decision against the local
    ///         mirror built only from successful Attestcoin verifications (see
    ///         {_processPledge}) — still fully trustless, since that mirror can only be set by a
    ///         real, proved Sepolia transaction, never by a caller's say-so.
    function applyForMortgage(uint256 deedId, uint256 propertyValueUsd, uint256 loanAmount)
        external
        returns (uint256 applicationId)
    {
        applicationId = nextApplicationId++;

        if (deedIsPledgedElsewhere[deedId]) {
            applications[applicationId] = Mortgage({
                deedId: deedId,
                propertyValueUsd: propertyValueUsd,
                loanAmount: loanAmount,
                status: ApplicationStatus.Rejected,
                createdAt: block.timestamp,
                amountRepaid: 0
            });
            emit MortgageRejected(applicationId, deedId, pledgorOfDeed[deedId], pledgedLoanAmount[deedId]);
        } else {
            applications[applicationId] = Mortgage({
                deedId: deedId,
                propertyValueUsd: propertyValueUsd,
                loanAmount: loanAmount,
                status: ApplicationStatus.Approved,
                createdAt: block.timestamp,
                amountRepaid: 0
            });
            emit MortgageApproved(applicationId, deedId, loanAmount);
        }
    }

    function getApplication(uint256 applicationId) external view returns (Mortgage memory) {
        return applications[applicationId];
    }

    // ── ASCBase hook ─────────────────────────────────────────────────────────────────────────

    /// @dev Invoked by {ASCBase.execute} only after the Block Prover precompile has verified
    ///      inclusion and the query id has been marked processed — this function itself never
    ///      touches the precompile or replay protection, both are handled by the base contract.
    function _processAndEmitEvent(uint8 action, bytes32 queryId, bytes memory encodedTransaction)
        internal
        override
    {
        if (action == uint8(SolumActions.PledgeAttested)) {
            _processPledge(queryId, encodedTransaction);
        } else {
            revert InvalidAction(action);
        }
    }

    function _processPledge(bytes32 queryId, bytes memory encodedTransaction) internal {
        EvmV1Decoder.LogEntry[] memory logs = _validatedLogs(encodedTransaction, PLEDGE_EVENT_SIGNATURE);
        (uint256 deedId, address pledgor, uint256 loanAmount) = _decodePledgeLog(logs);

        deedIsPledgedElsewhere[deedId] = true;
        pledgorOfDeed[deedId] = pledgor;
        pledgedLoanAmount[deedId] = loanAmount;

        emit PledgeAttested(deedId, pledgor, loanAmount, queryId);
    }

    /// @dev Mirrors the reference `_validateTransactionContents` pattern: validate tx type, check
    ///      the receipt actually succeeded — the precompile only proves inclusion, not success —
    ///      then filter logs by event signature.
    function _validatedLogs(bytes memory encodedTransaction, bytes32 eventSignature)
        internal
        pure
        returns (EvmV1Decoder.LogEntry[] memory selected)
    {
        uint8 txType = EvmV1Decoder.getTransactionType(encodedTransaction);
        require(EvmV1Decoder.isValidTransactionType(txType), "Unsupported transaction type");

        EvmV1Decoder.ReceiptFields memory receipt = EvmV1Decoder.decodeReceiptFields(encodedTransaction);
        require(receipt.receiptStatus == 1, "Source transaction did not succeed");

        selected = EvmV1Decoder.getLogsByEventSignature(receipt, eventSignature);
        require(selected.length > 0, "No CollateralPledged events found");
    }

    function _decodePledgeLog(EvmV1Decoder.LogEntry[] memory logs)
        internal
        view
        returns (uint256 deedId, address pledgor, uint256 loanAmount)
    {
        require(pledgeVault != address(0), "Pledge vault not registered");

        // For this demo we only process the first matching log per transaction.
        EvmV1Decoder.LogEntry memory log = logs[0];

        require(log.address_ == pledgeVault, "CollateralPledged not emitted by the registered pledge vault");
        require(log.topics.length == 3, "Invalid CollateralPledged topics");
        require(log.topics[0] == PLEDGE_EVENT_SIGNATURE, "Not a CollateralPledged event");

        deedId = uint256(log.topics[1]);
        pledgor = address(uint160(uint256(log.topics[2])));

        require(log.data.length == 64, "Invalid CollateralPledged data");
        (loanAmount,) = abi.decode(log.data, (uint256, uint256));
    }
}
