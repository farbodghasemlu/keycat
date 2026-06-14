// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../src/KeycatRecoveryController.sol";

interface Vm {
    function prank(address msgSender) external;
    function expectRevert(bytes4 revertData) external;
    function warp(uint256 newTimestamp) external;
}

contract MockEmailAuth {
    address public controller;
    bytes32 public accountSalt;
    mapping(bytes32 nullifier => bool used) public usedNullifiers;

    function initialize(address, bytes32 accountSalt_, address controller_) external {
        require(controller == address(0), "initialized");
        accountSalt = accountSalt_;
        controller = controller_;
    }

    function initDKIMRegistry(address) external view {
        require(msg.sender == controller, "only controller");
    }

    function initVerifier(address) external view {
        require(msg.sender == controller, "only controller");
    }

    function insertCommandTemplate(uint256, string[] calldata) external view {
        require(msg.sender == controller, "only controller");
    }

    function authEmail(EmailAuthMsg calldata emailAuthMsg) external {
        require(msg.sender == controller, "only controller");
        require(emailAuthMsg.proof.isCodeExist, "code missing");
        require(emailAuthMsg.proof.accountSalt == accountSalt, "salt mismatch");
        require(!usedNullifiers[emailAuthMsg.proof.emailNullifier], "used nullifier");
        require(emailAuthMsg.proof.proof.length != 0, "mock proof missing");
        usedNullifiers[emailAuthMsg.proof.emailNullifier] = true;
    }
}

contract MockHybridAccount {
    address public owner;
    address public immutable delegationManager;

    constructor(address owner_, address delegationManager_) {
        owner = owner_;
        delegationManager = delegationManager_;
    }

    function configureRecovery(
        KeycatRecoveryController controller,
        bytes32 commitment,
        uint256 timelock,
        bytes calldata permissionContext
    ) external {
        controller.configureRecovery(address(this), commitment, timelock, permissionContext);
    }

    function cancelRecovery(KeycatRecoveryController controller) external {
        controller.cancelRecovery(address(this));
    }

    function transferOwnership(address newOwner) external {
        require(msg.sender == address(this), "only self");
        owner = newOwner;
    }

    function executeFromExecutor(bytes32 mode, bytes calldata executionCalldata) external {
        require(msg.sender == delegationManager, "only delegation manager");
        require(mode == bytes32(0), "bad mode");
        (address target,, bytes memory callData) = decodeSingle(executionCalldata);
        require(target == address(this), "bad target");
        (bool ok, bytes memory returnData) = address(this).call(callData);
        if (!ok) {
            assembly {
                revert(add(returnData, 32), mload(returnData))
            }
        }
    }

    function isValidOwner(address candidate) external view returns (bool) {
        return candidate == owner;
    }

    function decodeSingle(bytes calldata executionCalldata)
        private
        pure
        returns (address target, uint256 value, bytes memory callData)
    {
        require(executionCalldata.length >= 52, "bad execution");
        target = address(bytes20(executionCalldata[0:20]));
        value = uint256(bytes32(executionCalldata[20:52]));
        callData = executionCalldata[52:];
    }
}

contract MockDelegationManager {
    address public immutable expectedEnforcer;

    constructor(address expectedEnforcer_) {
        expectedEnforcer = expectedEnforcer_;
    }

    function redeemDelegations(
        bytes[] calldata permissionContexts,
        bytes32[] calldata modes,
        bytes[] calldata executionCallDatas
    ) external {
        require(permissionContexts.length == 1 && modes.length == 1 && executionCallDatas.length == 1, "bad arrays");
        Delegation[] memory delegations = abi.decode(permissionContexts[0], (Delegation[]));
        require(delegations.length == 1, "bad delegation length");
        require(delegations[0].delegate == msg.sender, "bad delegate");
        require(delegations[0].caveats.length == 1, "bad caveats");
        require(delegations[0].caveats[0].enforcer == expectedEnforcer, "bad enforcer");
        MockHybridAccount(delegations[0].delegator).executeFromExecutor(modes[0], executionCallDatas[0]);
    }
}

contract KeycatRecoveryControllerTest {
    Vm private constant vm = Vm(address(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D));

    address private constant OLD_OWNER = address(0xA11CE);
    address private constant NEW_OWNER = address(0xB0B);
    address private constant NON_OWNER = address(0xCAFE);
    address private constant VERIFIER = address(0x1001);
    address private constant DKIM = address(0x1002);
    address private constant ENFORCER = address(0x1003);
    bytes32 private constant COMMITMENT = keccak256("salted guardian email account salt");
    uint256 private constant TIMELOCK = 2 days;

    KeycatRecoveryController private controller;
    MockDelegationManager private delegationManager;
    MockHybridAccount private account;

    function setUp() public {
        MockEmailAuth emailAuth = new MockEmailAuth();
        delegationManager = new MockDelegationManager(ENFORCER);
        controller = new KeycatRecoveryController(
            VERIFIER,
            DKIM,
            address(emailAuth),
            address(delegationManager),
            ENFORCER
        );
        account = new MockHybridAccount(OLD_OWNER, address(delegationManager));

        account.configureRecovery(
            controller,
            COMMITMENT,
            TIMELOCK,
            _permissionContext(address(account))
        );
    }

    function testLifecycleConfigureRequestCancelRequestExecute() public {
        controller.handleRecovery(_emailAuthMsg(address(account), NEW_OWNER, COMMITMENT, keccak256("n1")), 0);
        KeycatRecoveryController.PendingRecovery memory pending = controller.getPendingRecovery(address(account));
        _assertTrue(pending.exists, "pending");
        _assertEq(pending.newOwner, NEW_OWNER, "new owner");
        _assertEq(pending.executeAfter, uint64(block.timestamp + TIMELOCK), "execute after");

        vm.expectRevert(KeycatRecoveryController.OnlyOwner.selector);
        controller.cancelRecovery(address(account));

        account.cancelRecovery(controller);
        pending = controller.getPendingRecovery(address(account));
        _assertTrue(!pending.exists, "cancelled");

        controller.handleRecovery(_emailAuthMsg(address(account), NEW_OWNER, COMMITMENT, keccak256("n2")), 0);
        vm.expectRevert(KeycatRecoveryController.TimelockNotExpired.selector);
        controller.executeRecovery(address(account));

        vm.warp(block.timestamp + TIMELOCK);
        controller.executeRecovery(address(account));
        _assertEq(account.owner(), NEW_OWNER, "rotated owner");
        _assertTrue(!account.isValidOwner(OLD_OWNER), "old owner invalid");
        _assertTrue(account.isValidOwner(NEW_OWNER), "new owner valid");
    }

    function testWrongCommitmentRejected() public {
        EmailAuthMsg memory message =
            _emailAuthMsg(address(account), NEW_OWNER, keccak256("wrong"), keccak256("n3"));
        vm.expectRevert(KeycatRecoveryController.InvalidEmailProof.selector);
        controller.handleRecovery(message, 0);
    }

    function testPrematureExecuteRejected() public {
        controller.handleRecovery(_emailAuthMsg(address(account), NEW_OWNER, COMMITMENT, keccak256("n4")), 0);
        vm.expectRevert(KeycatRecoveryController.TimelockNotExpired.selector);
        controller.executeRecovery(address(account));
    }

    function testReplayedProofNullifierRejected() public {
        bytes32 nullifier = keccak256("replay");
        controller.handleRecovery(_emailAuthMsg(address(account), NEW_OWNER, COMMITMENT, nullifier), 0);
        account.cancelRecovery(controller);

        EmailAuthMsg memory message =
            _emailAuthMsg(address(account), NEW_OWNER, COMMITMENT, nullifier);
        vm.expectRevert(KeycatRecoveryController.EmailNullifierAlreadyUsed.selector);
        controller.handleRecovery(message, 0);
    }

    function testOnlyAccountCanConfigure() public {
        bytes memory permissionContext = _permissionContext(address(account));
        vm.expectRevert(KeycatRecoveryController.OnlyAccount.selector);
        controller.configureRecovery(address(account), COMMITMENT, TIMELOCK, permissionContext);
    }

    function testInvalidDelegationRejected() public {
        Delegation[] memory delegations = new Delegation[](1);
        delegations[0].delegate = address(controller);
        delegations[0].delegator = address(account);
        delegations[0].authority = controller.ROOT_AUTHORITY();
        delegations[0].salt = 1;
        delegations[0].signature = hex"abcd";
        delegations[0].caveats = new Caveat[](1);
        delegations[0].caveats[0] = Caveat({
            enforcer: ENFORCER,
            terms: abi.encodePacked(address(0xBAD)),
            args: hex"00"
        });

        vm.expectRevert(KeycatRecoveryController.InvalidDelegation.selector);
        account.configureRecovery(controller, COMMITMENT, TIMELOCK, abi.encode(delegations));
    }

    function _emailAuthMsg(
        address recoveredAccount,
        address newOwner,
        bytes32 accountSalt,
        bytes32 nullifier
    ) private view returns (EmailAuthMsg memory message) {
        message.templateId = controller.computeRecoveryTemplateId(0);
        message.commandParams = new bytes[](2);
        message.commandParams[0] = abi.encode(recoveredAccount);
        message.commandParams[1] = abi.encode(newOwner);
        message.proof = EmailProof({
            domainName: "example.com",
            publicKeyHash: bytes32(uint256(1)),
            timestamp: block.timestamp,
            maskedCommand: "",
            emailNullifier: nullifier,
            accountSalt: accountSalt,
            isCodeExist: true,
            proof: hex"01"
        });
    }

    function _permissionContext(address delegator) private view returns (bytes memory) {
        Delegation[] memory delegations = new Delegation[](1);
        delegations[0].delegate = address(controller);
        delegations[0].delegator = delegator;
        delegations[0].authority = controller.ROOT_AUTHORITY();
        delegations[0].salt = 1;
        delegations[0].signature = hex"abcd";
        delegations[0].caveats = new Caveat[](1);
        delegations[0].caveats[0] = Caveat({
            enforcer: ENFORCER,
            terms: abi.encodePacked(delegator),
            args: hex"00"
        });
        return abi.encode(delegations);
    }

    function _assertEq(address actual, address expected, string memory label) private pure {
        require(actual == expected, label);
    }

    function _assertEq(uint64 actual, uint64 expected, string memory label) private pure {
        require(actual == expected, label);
    }

    function _assertTrue(bool condition, string memory label) private pure {
        require(condition, label);
    }
}
