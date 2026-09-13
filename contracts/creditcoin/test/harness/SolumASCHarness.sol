// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {SolumASC} from "../../src/SolumASC.sol";
import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";

/// @dev Test harness exposing the internal log validator for source-contract binding tests,
///      mirroring the official examples' `ASCLoanManagerHarness` pattern.
contract SolumASCHarness is SolumASC {
    function exposeDecodePledgeLog(EvmV1Decoder.LogEntry[] memory logs)
        external
        view
        returns (uint256 deedId, address pledgor, uint256 loanAmount)
    {
        return _decodePledgeLog(logs);
    }
}
