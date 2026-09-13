// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {PropertyDeed} from "../src/PropertyDeed.sol";
import {PledgeVault} from "../src/PledgeVault.sol";

contract PledgeVaultTest is Test {
    PropertyDeed internal deed;
    PledgeVault internal vault;

    address internal owner = address(this);
    address internal amara = address(0xA114A);

    function setUp() public {
        deed = new PropertyDeed();
        vault = new PledgeVault(address(deed));
    }

    function testPledge_locksDeedAndEmitsEvent() public {
        uint256 deedId = deed.mint(amara, "ipfs://amara-rental");

        vm.startPrank(amara);
        deed.approve(address(vault), deedId);

        vm.expectEmit(true, true, false, true);
        emit PledgeVault.CollateralPledged(deedId, amara, 40_000, block.timestamp);
        uint256 loanId = vault.pledge(deedId, 40_000);
        vm.stopPrank();

        assertEq(deed.ownerOf(deedId), address(vault));
        (uint256 pledgedDeedId, address pledgor, uint256 loanAmount,,) = vault.loans(loanId);
        assertEq(pledgedDeedId, deedId);
        assertEq(pledgor, amara);
        assertEq(loanAmount, 40_000);
    }

    function testPledge_revertsIfCallerDoesNotOwnDeed() public {
        uint256 deedId = deed.mint(amara, "ipfs://amara-rental");

        vm.expectRevert(PledgeVault.NotDeedOwner.selector);
        vault.pledge(deedId, 40_000);
    }

    function testMakePayment_accumulatesRepaid() public {
        uint256 deedId = deed.mint(amara, "ipfs://amara-rental");
        vm.startPrank(amara);
        deed.approve(address(vault), deedId);
        uint256 loanId = vault.pledge(deedId, 40_000);
        vm.stopPrank();

        vault.makePayment{value: 1 ether}(loanId);
        (,,, uint256 repaid,) = vault.loans(loanId);
        assertEq(repaid, 1 ether);
    }

    function testRelease_returnsDeedToPledgor() public {
        uint256 deedId = deed.mint(amara, "ipfs://amara-rental");
        vm.startPrank(amara);
        deed.approve(address(vault), deedId);
        uint256 loanId = vault.pledge(deedId, 40_000);
        vm.stopPrank();

        vault.release(loanId);
        assertEq(deed.ownerOf(deedId), amara);
    }
}
