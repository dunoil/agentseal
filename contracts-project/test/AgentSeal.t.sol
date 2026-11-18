// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AgentSeal} from "../contracts/AgentSeal.sol";
import {MockAgentID} from "../contracts/MockAgentID.sol";

/// @dev Minimal cheatcode interface — declared by hand so the project has
///      ZERO dependencies (no forge-std download needed).
interface Vm {
    function warp(uint256 newTimestamp) external;
    function prank(address msgSender) external;
    function deal(address account, uint256 newBalance) external;
    function expectRevert(bytes calldata revertData) external;
    function expectRevert() external;
}

/// @title AgentSealTest — full behavioural suite, run with `forge test`.
/// @notice Gas is not deducted from pranked accounts in the forge test EVM,
///         so every balance assertion below is exact to the wei.
contract AgentSealTest {
    Vm private constant vm = Vm(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D);

    AgentSeal private seal;
    MockAgentID private mock;

    address private constant ALICE = address(0x1001); // typical client
    address private constant BOB = address(0x1002);   // typical provider
    address private constant CAROL = address(0x1003);
    address private constant DAVE = address(0x1004);
    address private constant STRANGER = address(0x1005); // never holds an Agent ID

    bytes32 private constant HASH = keccak256("deliverable-v1");

    // ---------------------------------------------------------------
    // Tiny assertion helpers (revert => forge marks the test failed)
    // ---------------------------------------------------------------
    function assertTrue(bool cond, string memory what) internal pure {
        if (!cond) revert(string.concat("assertTrue failed: ", what));
    }

    function assertEq(uint256 a, uint256 b, string memory what) internal pure {
        if (a != b) revert(string.concat("assertEq failed: ", what));
    }

    function assertEq(address a, address b, string memory what) internal pure {
        if (a != b) revert(string.concat("assertEq failed: ", what));
    }

    function assertEqStr(string memory a, string memory b, string memory what) internal pure {
        if (keccak256(bytes(a)) != keccak256(bytes(b))) revert(string.concat("assertEqStr failed: ", what));
    }

    // ---------------------------------------------------------------
    // Setup helpers
    // ---------------------------------------------------------------
    function setUp() public {
        mock = new MockAgentID();
        seal = new AgentSeal(address(mock));
        vm.deal(ALICE, 100 ether);
        vm.deal(BOB, 100 ether);
        vm.deal(CAROL, 100 ether);
        vm.deal(DAVE, 100 ether);
        vm.deal(STRANGER, 100 ether);
    }

    function _giveIDs() internal {
        mock.mint(ALICE);
        mock.mint(BOB);
        mock.mint(CAROL);
        mock.mint(DAVE);
    }

    function _register(address who, string memory category) internal {
        vm.prank(who);
        seal.registerProfile(category, "ipfs://profile");
    }

    function _createJob(address client, address provider, uint256 amount, uint256 deadline) internal returns (uint256) {
        vm.prank(client);
        return seal.createJob{value: amount}(provider, "ipfs://job", deadline);
    }

    function _state(uint256 jobId) internal view returns (AgentSeal.JobState) {
        (, , , , , , , AgentSeal.JobState state, ) = seal.getJob(jobId);
        return state;
    }

    // ---------------------------------------------------------------
    // Agent ID gate
    // ---------------------------------------------------------------
    function test_NonHolderCannotRegister() public {
        vm.prank(STRANGER);
        vm.expectRevert(bytes("AgentSeal: no Agent ID"));
        seal.registerProfile("research", "ipfs://x");
    }

    function test_NonHolderCannotVouch() public {
        _giveIDs();
        _register(ALICE, "research");
        vm.prank(STRANGER);
        vm.expectRevert(bytes("AgentSeal: no Agent ID"));
        seal.vouch(ALICE);
    }

    function test_NonHolderCannotCreateJob() public {
        _giveIDs();
        _register(BOB, "design");
        vm.prank(STRANGER);
        vm.expectRevert(bytes("AgentSeal: no Agent ID"));
        seal.createJob{value: 0.1 ether}(BOB, "ipfs://job", block.timestamp + 1 days);
    }

    function test_NonHolderCannotAcceptJob() public {
        _giveIDs();
        _register(BOB, "design");
        uint256 id = _createJob(ALICE, BOB, 0.1 ether, block.timestamp + 1 days);
        vm.prank(STRANGER);
        vm.expectRevert(bytes("AgentSeal: no Agent ID"));
        seal.acceptJob(id);
    }

    // ---------------------------------------------------------------
    // Profiles & founding numbers
    // ---------------------------------------------------------------
    function test_FoundingNumbersAreSequential() public {
        _giveIDs();
        _register(ALICE, "research");
        _register(BOB, "design");
        (bool regA, , , uint256 foundA, ) = seal.getProfile(ALICE);
        (bool regB, , , uint256 foundB, ) = seal.getProfile(BOB);
        assertTrue(regA && regB, "both registered");
        assertEq(foundA, 1, "alice founding number");
        assertEq(foundB, 2, "bob founding number");
        assertEq(seal.profileCount(), 2, "profileCount");
    }

    function test_DuplicateRegistrationRejected() public {
        _giveIDs();
        _register(ALICE, "research");
        vm.prank(ALICE);
        vm.expectRevert(bytes("AgentSeal: already registered"));
        seal.registerProfile("again", "ipfs://a2");
    }

    function test_UpdateProfile() public {
        _giveIDs();
        _register(ALICE, "research");
        vm.prank(ALICE);
        seal.updateProfile("data", "ipfs://a-v2");
        (, string memory cat, string memory uri, uint256 founding, ) = seal.getProfile(ALICE);
        assertEqStr(cat, "data", "category updated");
        assertEqStr(uri, "ipfs://a-v2", "uri updated");
        assertEq(founding, 1, "founding number kept");
    }

    function test_UnregisteredCannotUpdateProfile() public {
        _giveIDs();
        vm.prank(CAROL);
        vm.expectRevert(bytes("AgentSeal: not registered"));
        seal.updateProfile("x", "ipfs://c");
    }

    // ---------------------------------------------------------------
    // Vouching
    // ---------------------------------------------------------------
    function test_VouchIncrementsCount() public {
        _giveIDs();
        _register(ALICE, "research");
        vm.prank(BOB);
        seal.vouch(ALICE);
        vm.prank(CAROL);
        seal.vouch(ALICE);
        (, , , , uint256 vouches) = seal.getProviderStats(ALICE);
        assertEq(vouches, 2, "vouch count");
        assertTrue(seal.hasVouched(ALICE, BOB), "hasVouched bob");
    }

    function test_DuplicateVouchRejected() public {
        _giveIDs();
        _register(ALICE, "research");
        vm.prank(BOB);
        seal.vouch(ALICE);
        vm.prank(BOB);
        vm.expectRevert(bytes("AgentSeal: already vouched"));
        seal.vouch(ALICE);
    }

    function test_SelfVouchRejected() public {
        _giveIDs();
        _register(ALICE, "research");
        vm.prank(ALICE);
        vm.expectRevert(bytes("AgentSeal: cannot vouch for yourself"));
        seal.vouch(ALICE);
    }

    function test_VouchUnregisteredRejected() public {
        _giveIDs();
        vm.prank(BOB);
        vm.expectRevert(bytes("AgentSeal: provider not registered"));
        seal.vouch(DAVE);
    }

    // ---------------------------------------------------------------
    // Happy path: create -> accept -> deliver -> release -> rate
    // ---------------------------------------------------------------
    function test_HappyPathExactBalancesAndStats() public {
        _giveIDs();
        _register(BOB, "design");
        uint256 amount = 0.5 ether;
        uint256 id = _createJob(ALICE, BOB, amount, block.timestamp + 2 days);

        assertEq(address(seal).balance, amount, "escrow holds exact amount");
        assertTrue(_state(id) == AgentSeal.JobState.Open, "state Open");

        vm.prank(BOB);
        seal.acceptJob(id);
        assertTrue(_state(id) == AgentSeal.JobState.Accepted, "state Accepted");

        vm.prank(BOB);
        seal.deliverJob(id, HASH);
        (, , , , , uint256 deliveredAt, bytes32 hash, AgentSeal.JobState st, ) = seal.getJob(id);
        assertTrue(st == AgentSeal.JobState.Delivered, "state Delivered");
        assertTrue(hash == HASH, "deliverable hash stored");
        assertTrue(deliveredAt > 0, "deliveredAt set");

        uint256 bobBefore = BOB.balance;
        vm.prank(ALICE);
        seal.releaseJob(id);
        assertEq(BOB.balance - bobBefore, amount, "provider paid exact escrow");
        assertEq(address(seal).balance, 0, "contract empty after release");
        assertTrue(_state(id) == AgentSeal.JobState.Released, "state Released");

        (uint256 settled, uint256 volume, , , ) = seal.getProviderStats(BOB);
        assertEq(settled, 1, "jobsSettled");
        assertEq(volume, amount, "volumeSettled");

        vm.prank(ALICE);
        seal.rateJob(id, 5);
        (, , uint256 rSum, uint256 rCount, ) = seal.getProviderStats(BOB);
        assertEq(rSum, 5, "ratingSum");
        assertEq(rCount, 1, "ratingCount");
    }

    function test_ThirdPartyCannotAcceptOrDeliver() public {
        _giveIDs();
        _register(BOB, "design");
        uint256 id = _createJob(ALICE, BOB, 0.1 ether, block.timestamp + 1 days);
        vm.prank(ALICE);
        vm.expectRevert(bytes("AgentSeal: not the provider"));
        seal.acceptJob(id);
        vm.prank(BOB);
        seal.acceptJob(id);
        vm.prank(ALICE);
        vm.expectRevert(bytes("AgentSeal: not the provider"));
        seal.deliverJob(id, HASH);
    }

    function test_ReleaseBeforeDeliveryRejected() public {
        _giveIDs();
        _register(BOB, "design");
        uint256 id = _createJob(ALICE, BOB, 0.1 ether, block.timestamp + 1 days);
        vm.prank(BOB);
        seal.acceptJob(id);
        vm.prank(ALICE);
        vm.expectRevert(bytes("AgentSeal: job not delivered"));
        seal.releaseJob(id);
    }

    function test_RatingRules() public {
        _giveIDs();
        _register(BOB, "design");
        uint256 id = _createJob(ALICE, BOB, 0.1 ether, block.timestamp + 1 days);

        // rating before settlement
        vm.prank(ALICE);
        vm.expectRevert(bytes("AgentSeal: job not settled"));
        seal.rateJob(id, 5);

        vm.prank(BOB);
        seal.acceptJob(id);
        vm.prank(BOB);
        seal.deliverJob(id, HASH);
        vm.prank(ALICE);
        seal.releaseJob(id);

        // non-client cannot rate
        vm.prank(BOB);
        vm.expectRevert(bytes("AgentSeal: not the client"));
        seal.rateJob(id, 5);
        // out of range
        vm.prank(ALICE);
        vm.expectRevert(bytes("AgentSeal: rating out of range"));
        seal.rateJob(id, 6);
        // valid rating, then double rating rejected
        vm.prank(ALICE);
        seal.rateJob(id, 4);
        vm.prank(ALICE);
        vm.expectRevert(bytes("AgentSeal: already rated"));
        seal.rateJob(id, 3);
    }

    // ---------------------------------------------------------------
    // Refund paths
    // ---------------------------------------------------------------
    function test_CancelBeforeAcceptanceRefundsInFull() public {
        _giveIDs();
        _register(BOB, "data");
        uint256 amount = 0.25 ether;
        uint256 id = _createJob(ALICE, BOB, amount, block.timestamp + 1 days);
        uint256 before = ALICE.balance;
        vm.prank(ALICE);
        seal.cancelJob(id);
        assertEq(ALICE.balance - before, amount, "full refund");
        assertTrue(_state(id) == AgentSeal.JobState.Refunded, "state Refunded");
        assertEq(address(seal).balance, 0, "contract empty");
    }

    function test_CancelAcceptedUndeliveredAfterDeadline() public {
        _giveIDs();
        _register(BOB, "data");
        uint256 amount = 0.25 ether;
        uint256 id = _createJob(ALICE, BOB, amount, block.timestamp + 1 hours);
        vm.prank(BOB);
        seal.acceptJob(id);
        // too early to cancel an accepted job
        vm.prank(ALICE);
        vm.expectRevert(bytes("AgentSeal: cannot cancel now"));
        seal.cancelJob(id);
        // after the deadline, undelivered => refundable
        vm.warp(block.timestamp + 1 hours + 1);
        uint256 before = ALICE.balance;
        vm.prank(ALICE);
        seal.cancelJob(id);
        assertEq(ALICE.balance - before, amount, "late refund in full");
        assertTrue(_state(id) == AgentSeal.JobState.Refunded, "state Refunded");
    }

    function test_DeliveredJobCannotBeCancelled() public {
        _giveIDs();
        _register(BOB, "data");
        uint256 id = _createJob(ALICE, BOB, 0.1 ether, block.timestamp + 1 days);
        vm.prank(BOB);
        seal.acceptJob(id);
        vm.prank(BOB);
        seal.deliverJob(id, HASH);
        vm.prank(ALICE);
        vm.expectRevert(bytes("AgentSeal: cannot cancel now"));
        seal.cancelJob(id);
    }

    // ---------------------------------------------------------------
    // Claim after window
    // ---------------------------------------------------------------
    function test_ClaimAfterWindow() public {
        _giveIDs();
        _register(BOB, "research");
        uint256 amount = 0.3 ether;
        uint256 id = _createJob(ALICE, BOB, amount, block.timestamp + 7 days);
        vm.prank(BOB);
        seal.acceptJob(id);
        vm.prank(BOB);
        seal.deliverJob(id, HASH);

        vm.prank(BOB);
        vm.expectRevert(bytes("AgentSeal: window not elapsed"));
        seal.claimAfterWindow(id);

        vm.warp(block.timestamp + 3 days + 1);
        uint256 before = BOB.balance;
        vm.prank(BOB);
        seal.claimAfterWindow(id);
        assertEq(BOB.balance - before, amount, "claim pays exact escrow");
        assertTrue(_state(id) == AgentSeal.JobState.ClaimedAfterWindow, "state ClaimedAfterWindow");
        (uint256 settled, uint256 volume, , , ) = seal.getProviderStats(BOB);
        assertEq(settled, 1, "claim counts as settled");
        assertEq(volume, amount, "claim volume");

        // release after claim is impossible; rating still works
        vm.prank(ALICE);
        vm.expectRevert(bytes("AgentSeal: job not delivered"));
        seal.releaseJob(id);
        vm.prank(ALICE);
        seal.rateJob(id, 4);
        (, , , , uint8 rating) = _jobRating(id);
        assertEq(rating, 4, "rating stored after claim");
    }

    function _jobRating(uint256 jobId) internal view returns (address, address, uint256, uint256, uint8) {
        (address client, address provider, uint256 amount, , , , , , uint8 rating) = seal.getJob(jobId);
        return (client, provider, amount, 0, rating);
    }

    // ---------------------------------------------------------------
    // Pause behaviour
    // ---------------------------------------------------------------
    function test_NonOwnerCannotPause() public {
        vm.prank(ALICE);
        vm.expectRevert(bytes("AgentSeal: not owner"));
        seal.setRegistrationsPaused(true);
    }

    function test_PauseRegistrations() public {
        _giveIDs();
        seal.setRegistrationsPaused(true); // test contract is the owner
        vm.prank(ALICE);
        vm.expectRevert(bytes("AgentSeal: registrations paused"));
        seal.registerProfile("x", "ipfs://a");
        seal.setRegistrationsPaused(false);
        _register(ALICE, "x");
        assertTrue(seal.isRegistered(ALICE), "registered after unpause");
    }

    function test_PauseJobCreationNeverBlocksSettlement() public {
        _giveIDs();
        _register(BOB, "design");
        uint256 id = _createJob(ALICE, BOB, 0.1 ether, block.timestamp + 1 days);
        seal.setJobCreationPaused(true);
        vm.prank(ALICE);
        vm.expectRevert(bytes("AgentSeal: job creation paused"));
        seal.createJob{value: 0.1 ether}(BOB, "ipfs://j2", block.timestamp + 1 days);
        // existing job still settles end-to-end while creation is paused
        vm.prank(BOB);
        seal.acceptJob(id);
        vm.prank(BOB);
        seal.deliverJob(id, HASH);
        vm.prank(ALICE);
        seal.releaseJob(id);
        assertTrue(_state(id) == AgentSeal.JobState.Released, "settled while paused");
    }

    // ---------------------------------------------------------------
    // Owner cannot touch escrowed funds (hackathon red line)
    // ---------------------------------------------------------------
    function test_OwnerCannotMoveEscrow() public {
        _giveIDs();
        _register(BOB, "design");
        uint256 amount = 0.4 ether;
        uint256 id = _createJob(ALICE, BOB, amount, block.timestamp + 1 days);
        // the owner is the test contract itself: even it gets party-check reverts
        vm.expectRevert(bytes("AgentSeal: not the client"));
        seal.cancelJob(id);
        vm.expectRevert(bytes("AgentSeal: not the client"));
        seal.releaseJob(id);
        assertEq(address(seal).balance, amount, "escrow untouched");
        assertEq(seal.owner(), address(this), "owner is deployer");
    }

    function test_PlainTransferReverts() public {
        (bool ok, ) = address(seal).call{value: 0.01 ether}("");
        assertTrue(!ok, "plain transfer must revert (no receive/fallback)");
        assertEq(address(seal).balance, 0, "no stray funds accepted");
    }

    // ---------------------------------------------------------------
    // Unique interactor tracking
    // ---------------------------------------------------------------
    function test_UniqueInteractorsCountedOnce() public {
        _giveIDs();
        assertEq(seal.uniqueInteractorCount(), 0, "starts at zero");
        _register(ALICE, "research");
        _register(BOB, "design");
        assertEq(seal.uniqueInteractorCount(), 2, "two registrants");
        vm.prank(CAROL);
        seal.vouch(ALICE);
        vm.prank(CAROL);
        seal.vouch(BOB); // second gated action: must not double-count
        _createJob(ALICE, BOB, 0.05 ether, block.timestamp + 1 days);
        assertEq(seal.uniqueInteractorCount(), 3, "three unique interactors");
        assertTrue(seal.hasInteracted(CAROL), "carol marked");
        assertTrue(!seal.hasInteracted(STRANGER), "stranger unmarked");
    }

    // ---------------------------------------------------------------
    // Input validation
    // ---------------------------------------------------------------
    function test_CreateJobValidation() public {
        _giveIDs();
        _register(BOB, "design");
        _register(ALICE, "research");

        vm.prank(ALICE);
        vm.expectRevert(bytes("AgentSeal: zero payment"));
        seal.createJob{value: 0}(BOB, "ipfs://j", block.timestamp + 1 days);

        vm.prank(ALICE);
        vm.expectRevert(bytes("AgentSeal: provider not registered"));
        seal.createJob{value: 1}(CAROL, "ipfs://j", block.timestamp + 1 days);

        vm.prank(ALICE);
        vm.expectRevert(bytes("AgentSeal: cannot hire yourself"));
        seal.createJob{value: 1}(ALICE, "ipfs://j", block.timestamp + 1 days);

        vm.prank(ALICE);
        vm.expectRevert(bytes("AgentSeal: deadline in the past"));
        seal.createJob{value: 1}(BOB, "ipfs://j", block.timestamp - 1);
    }

    function test_JobCountAndBadId() public {
        _giveIDs();
        _register(BOB, "design");
        assertEq(seal.jobCount(), 0, "no jobs yet");
        _createJob(ALICE, BOB, 0.01 ether, block.timestamp + 1 days);
        assertEq(seal.jobCount(), 1, "one job");
        vm.expectRevert(bytes("AgentSeal: no such job"));
        seal.getJob(99);
    }
}
