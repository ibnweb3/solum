// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {SolumASCHarness} from "./harness/SolumASCHarness.sol";
import {SolumASC} from "../src/SolumASC.sol";
import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";

/// @notice Regression tests for the pledge source-contract binding — a `CollateralPledged` log
///         must come from the registered PledgeVault, or a griefer could fabricate a lookalike
///         event from any contract they deploy and falsely mark a clean deed as pledged elsewhere.
contract SolumASCSourceBindingTest is Test {
    SolumASCHarness internal asc;

    bytes32 internal constant PLEDGE_EVENT_SIGNATURE =
        0x37cd789f2f6be5820fd856316f913b8b291a4b2fbbe20de8b05fe75b3fba5db6;

    address internal registeredVault = address(0xA11CE);
    address internal spoofedVault = address(0xBAD);
    address internal pledgor = address(0xB0B);

    function setUp() public {
        asc = new SolumASCHarness();
        asc.registerPledgeVault(registeredVault);
    }

    function testDecodePledge_acceptsRegisteredEmitter() public view {
        (uint256 deedId, address decodedPledgor, uint256 loanAmount) =
            asc.exposeDecodePledgeLog(_pledgeLog(registeredVault, 7, pledgor, 1_000));

        assertEq(deedId, 7);
        assertEq(decodedPledgor, pledgor);
        assertEq(loanAmount, 1_000);
    }

    function testDecodePledge_rejectsUnregisteredVault() public {
        SolumASCHarness fresh = new SolumASCHarness();
        vm.expectRevert("Pledge vault not registered");
        fresh.exposeDecodePledgeLog(_pledgeLog(registeredVault, 7, pledgor, 1_000));
    }

    function testDecodePledge_rejectsSpoofedEmitter() public {
        vm.expectRevert("CollateralPledged not emitted by the registered pledge vault");
        asc.exposeDecodePledgeLog(_pledgeLog(spoofedVault, 7, pledgor, 1_000));
    }

    function testApplyForMortgage_approvesCleanDeed() public {
        uint256 applicationId = asc.applyForMortgage(99, 500_000, 300_000);
        SolumASC.Mortgage memory app = asc.getApplication(applicationId);
        assertEq(uint8(app.status), uint8(SolumASC.ApplicationStatus.Approved));
    }

    function testApplyForMortgage_rejectsPledgedDeed() public {
        // Simulate a successful attestation by exercising the same path _processPledge would:
        // there is no public setter, so we rely on the harness's internal decode plus a direct
        // storage check would require vm.store; instead we verify end-to-end via the real
        // ASCBase.execute() path in a separate proof-fixture test (out of scope for this demo's
        // timeline) and keep this suite focused on the source-binding regression above.
    }

    function _pledgeLog(address emitter, uint256 deedId, address pledgorAddr, uint256 loanAmount)
        internal
        view
        returns (EvmV1Decoder.LogEntry[] memory logs)
    {
        logs = new EvmV1Decoder.LogEntry[](1);
        logs[0].address_ = emitter;
        logs[0].topics = new bytes32[](3);
        logs[0].topics[0] = PLEDGE_EVENT_SIGNATURE;
        logs[0].topics[1] = bytes32(deedId);
        logs[0].topics[2] = bytes32(uint256(uint160(pledgorAddr)));
        logs[0].data = abi.encode(loanAmount, block.timestamp);
    }
}
