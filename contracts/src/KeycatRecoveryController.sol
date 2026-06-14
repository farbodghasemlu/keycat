// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

struct EmailProof {
    string domainName;
    bytes32 publicKeyHash;
    uint256 timestamp;
    string maskedCommand;
    bytes32 emailNullifier;
    bytes32 accountSalt;
    bool isCodeExist;
    bytes proof;
}

struct EmailAuthMsg {
    uint256 templateId;
    bytes[] commandParams;
    uint256 skippedCommandPrefix;
    EmailProof proof;
}

struct Caveat {
    address enforcer;
    bytes terms;
    bytes args;
}

struct Delegation {
    address delegate;
    address delegator;
    bytes32 authority;
    Caveat[] caveats;
    uint256 salt;
    bytes signature;
}

interface IEmailAuth {
    function initialize(address initialOwner, bytes32 accountSalt, address controller) external;
    function controller() external view returns (address);
    function initDKIMRegistry(address dkimRegistry) external;
    function initVerifier(address verifier) external;
    function insertCommandTemplate(uint256 templateId, string[] calldata commandTemplate) external;
    function authEmail(EmailAuthMsg calldata emailAuthMsg) external;
}

interface IDelegationManager {
    function redeemDelegations(
        bytes[] calldata permissionContexts,
        bytes32[] calldata modes,
        bytes[] calldata executionCallDatas
    ) external;
}

interface IHybridOwner {
    function owner() external view returns (address);
}

contract KeycatERC1967Proxy {
    bytes32 private constant IMPLEMENTATION_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    constructor(address implementation, bytes memory data) payable {
        assembly {
            sstore(IMPLEMENTATION_SLOT, implementation)
        }
        if (data.length != 0) {
            (bool ok, bytes memory returnData) = implementation.delegatecall(data);
            if (!ok) {
                assembly {
                    revert(add(returnData, 32), mload(returnData))
                }
            }
        }
    }

    fallback() external payable {
        _delegate();
    }

    receive() external payable {
        _delegate();
    }

    function _delegate() private {
        address implementation;
        assembly {
            implementation := sload(IMPLEMENTATION_SLOT)
            calldatacopy(0, 0, calldatasize())
            let result := delegatecall(gas(), implementation, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch result
            case 0 {
                revert(0, returndatasize())
            }
            default {
                return(0, returndatasize())
            }
        }
    }
}

contract KeycatRecoveryController {
    bytes32 public constant ROOT_AUTHORITY =
        0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff;
    bytes4 public constant TRANSFER_OWNERSHIP_SELECTOR = bytes4(keccak256("transferOwnership(address)"));
    bytes32 public constant MODE_SINGLE_DEFAULT = bytes32(0);
    uint256 public constant RECOVERY_TEMPLATE_INDEX = 0;

    address public immutable verifierAddr;
    address public immutable dkimAddr;
    address public immutable emailAuthImplementationAddr;
    address public immutable delegationManager;
    address public immutable ownershipTransferEnforcer;

    struct RecoveryConfig {
        bytes32 emailGuardianCommitment;
        uint64 timelockSeconds;
        bool configured;
        bytes permissionContext;
    }

    struct PendingRecovery {
        address newOwner;
        uint64 executeAfter;
        bytes32 emailNullifier;
        bool exists;
    }

    mapping(address account => RecoveryConfig config) private recoveryConfigs;
    mapping(address account => PendingRecovery recovery) private pendingRecoveries;
    mapping(bytes32 emailNullifier => bool used) public usedEmailNullifiers;

    event RecoveryConfigured(
        address indexed account,
        bytes32 indexed emailGuardianCommitment,
        uint256 timelockSeconds
    );
    event RecoveryRequested(address indexed account, address indexed newOwner, uint256 executeAfter);
    event RecoveryCancelled(address indexed account);
    event RecoveryExecuted(address indexed account, address indexed newOwner);

    error InvalidAddress();
    error InvalidCommitment();
    error InvalidTimelock();
    error InvalidTemplate();
    error InvalidCommand();
    error InvalidDelegation();
    error InvalidEmailProof();
    error RecoveryNotConfigured();
    error RecoveryAlreadyPending();
    error RecoveryNotPending();
    error TimelockNotExpired();
    error TimelockExpired();
    error OnlyAccount();
    error OnlyOwner();
    error EmailNullifierAlreadyUsed();

    constructor(
        address verifier_,
        address dkimRegistry,
        address emailAuthImplementation_,
        address delegationManager_,
        address ownershipTransferEnforcer_
    ) {
        if (
            verifier_ == address(0) || dkimRegistry == address(0)
                || emailAuthImplementation_ == address(0) || delegationManager_ == address(0)
                || ownershipTransferEnforcer_ == address(0)
        ) {
            revert InvalidAddress();
        }
        verifierAddr = verifier_;
        dkimAddr = dkimRegistry;
        emailAuthImplementationAddr = emailAuthImplementation_;
        delegationManager = delegationManager_;
        ownershipTransferEnforcer = ownershipTransferEnforcer_;
    }

    function verifier() public view returns (address) {
        return verifierAddr;
    }

    function dkim() public view returns (address) {
        return dkimAddr;
    }

    function emailAuthImplementation() public view returns (address) {
        return emailAuthImplementationAddr;
    }

    function getRecoveryConfig(address account) external view returns (RecoveryConfig memory) {
        return recoveryConfigs[account];
    }

    function getPendingRecovery(address account) external view returns (PendingRecovery memory) {
        return pendingRecoveries[account];
    }

    function configureRecovery(
        address account,
        bytes32 emailGuardianCommitment,
        uint256 timelockSeconds
    ) external {
        _configureRecovery(account, emailGuardianCommitment, timelockSeconds, "");
    }

    function configureRecovery(
        address account,
        bytes32 emailGuardianCommitment,
        uint256 timelockSeconds,
        bytes calldata permissionContext
    ) external {
        _configureRecovery(account, emailGuardianCommitment, timelockSeconds, permissionContext);
    }

    function recoveryCommandTemplates() public pure returns (string[][] memory templates) {
        templates = new string[][](1);
        templates[0] = _recoveryCommandTemplate();
    }

    function computeRecoveryTemplateId(uint256 templateIdx) public pure returns (uint256) {
        return uint256(keccak256(abi.encode(uint256(1), "RECOVERY", templateIdx)));
    }

    function computeEmailAuthAddress(
        address recoveredAccount,
        bytes32 accountSalt
    ) public view returns (address) {
        bytes memory initData = abi.encodeCall(
            IEmailAuth.initialize,
            (recoveredAccount, accountSalt, address(this))
        );
        bytes memory bytecode = abi.encodePacked(
            type(KeycatERC1967Proxy).creationCode,
            abi.encode(emailAuthImplementationAddr, initData)
        );
        bytes32 hash = keccak256(
            abi.encodePacked(bytes1(0xff), address(this), accountSalt, keccak256(bytecode))
        );
        return address(uint160(uint256(hash)));
    }

    function handleRecovery(EmailAuthMsg calldata emailAuthMsg, uint256 templateIdx) external {
        if (templateIdx != RECOVERY_TEMPLATE_INDEX) {
            revert InvalidTemplate();
        }
        if (
            emailAuthMsg.templateId != computeRecoveryTemplateId(templateIdx)
                || emailAuthMsg.commandParams.length != 2
        ) {
            revert InvalidCommand();
        }

        address account = abi.decode(emailAuthMsg.commandParams[0], (address));
        address newOwner = abi.decode(emailAuthMsg.commandParams[1], (address));
        if (account == address(0) || newOwner == address(0)) {
            revert InvalidAddress();
        }

        RecoveryConfig storage config = recoveryConfigs[account];
        if (!config.configured) {
            revert RecoveryNotConfigured();
        }
        if (pendingRecoveries[account].exists) {
            revert RecoveryAlreadyPending();
        }
        if (
            emailAuthMsg.proof.accountSalt == bytes32(0)
                || emailAuthMsg.proof.accountSalt != config.emailGuardianCommitment
                || !emailAuthMsg.proof.isCodeExist
        ) {
            revert InvalidEmailProof();
        }
        if (usedEmailNullifiers[emailAuthMsg.proof.emailNullifier]) {
            revert EmailNullifierAlreadyUsed();
        }

        IEmailAuth emailAuth = _prepareEmailAuth(account, emailAuthMsg.proof.accountSalt);
        emailAuth.authEmail(emailAuthMsg);
        usedEmailNullifiers[emailAuthMsg.proof.emailNullifier] = true;

        uint256 executeAfter = block.timestamp + uint256(config.timelockSeconds);
        if (executeAfter > type(uint64).max) {
            revert InvalidTimelock();
        }
        pendingRecoveries[account] = PendingRecovery({
            newOwner: newOwner,
            executeAfter: uint64(executeAfter),
            emailNullifier: emailAuthMsg.proof.emailNullifier,
            exists: true
        });

        emit RecoveryRequested(account, newOwner, executeAfter);
    }

    function cancelRecovery(address account) external {
        PendingRecovery memory recovery = pendingRecoveries[account];
        if (!recovery.exists) {
            revert RecoveryNotPending();
        }
        if (block.timestamp >= recovery.executeAfter) {
            revert TimelockExpired();
        }
        if (msg.sender != account && msg.sender != _ownerOf(account)) {
            revert OnlyOwner();
        }
        delete pendingRecoveries[account];
        emit RecoveryCancelled(account);
    }

    function executeRecovery(address account) external {
        PendingRecovery memory recovery = pendingRecoveries[account];
        if (!recovery.exists) {
            revert RecoveryNotPending();
        }
        if (block.timestamp < recovery.executeAfter) {
            revert TimelockNotExpired();
        }
        RecoveryConfig storage config = recoveryConfigs[account];
        if (config.permissionContext.length == 0) {
            revert InvalidDelegation();
        }

        delete pendingRecoveries[account];

        bytes[] memory permissionContexts = new bytes[](1);
        bytes32[] memory modes = new bytes32[](1);
        bytes[] memory executionCallDatas = new bytes[](1);
        bytes memory transferCalldata =
            abi.encodeWithSelector(TRANSFER_OWNERSHIP_SELECTOR, recovery.newOwner);

        permissionContexts[0] = config.permissionContext;
        modes[0] = MODE_SINGLE_DEFAULT;
        executionCallDatas[0] = abi.encodePacked(account, uint256(0), transferCalldata);

        IDelegationManager(delegationManager).redeemDelegations(
            permissionContexts,
            modes,
            executionCallDatas
        );

        emit RecoveryExecuted(account, recovery.newOwner);
    }

    function _configureRecovery(
        address account,
        bytes32 emailGuardianCommitment,
        uint256 timelockSeconds,
        bytes memory permissionContext
    ) internal {
        if (msg.sender != account) {
            revert OnlyAccount();
        }
        if (account == address(0)) {
            revert InvalidAddress();
        }
        if (emailGuardianCommitment == bytes32(0)) {
            revert InvalidCommitment();
        }
        if (timelockSeconds == 0 || timelockSeconds > type(uint64).max) {
            revert InvalidTimelock();
        }
        if (pendingRecoveries[account].exists) {
            revert RecoveryAlreadyPending();
        }
        if (permissionContext.length != 0) {
            _validatePermissionContext(account, permissionContext);
        }

        recoveryConfigs[account] = RecoveryConfig({
            emailGuardianCommitment: emailGuardianCommitment,
            timelockSeconds: uint64(timelockSeconds),
            configured: true,
            permissionContext: permissionContext
        });

        emit RecoveryConfigured(account, emailGuardianCommitment, timelockSeconds);
    }

    function _prepareEmailAuth(
        address account,
        bytes32 accountSalt
    ) internal returns (IEmailAuth emailAuth) {
        address emailAuthAddress = computeEmailAuthAddress(account, accountSalt);
        if (emailAuthAddress.code.length == 0) {
            bytes memory initData = abi.encodeCall(
                IEmailAuth.initialize,
                (account, accountSalt, address(this))
            );
            emailAuthAddress = address(
                new KeycatERC1967Proxy{salt: accountSalt}(
                    emailAuthImplementationAddr,
                    initData
                )
            );
            emailAuth = IEmailAuth(emailAuthAddress);
            emailAuth.initDKIMRegistry(dkimAddr);
            emailAuth.initVerifier(verifierAddr);
            emailAuth.insertCommandTemplate(
                computeRecoveryTemplateId(RECOVERY_TEMPLATE_INDEX),
                _recoveryCommandTemplate()
            );
        } else {
            emailAuth = IEmailAuth(emailAuthAddress);
            if (emailAuth.controller() != address(this)) {
                revert InvalidEmailProof();
            }
        }
    }

    function _validatePermissionContext(address account, bytes memory permissionContext) internal view {
        Delegation[] memory delegations = abi.decode(permissionContext, (Delegation[]));
        if (delegations.length != 1) {
            revert InvalidDelegation();
        }
        Delegation memory delegation = delegations[0];
        if (
            delegation.delegate != address(this) || delegation.delegator != account
                || delegation.authority != ROOT_AUTHORITY || delegation.signature.length == 0
                || delegation.caveats.length != 1
        ) {
            revert InvalidDelegation();
        }
        Caveat memory caveat = delegation.caveats[0];
        if (
            caveat.enforcer != ownershipTransferEnforcer || caveat.terms.length != 20
                || _addressFromPackedBytes(caveat.terms) != account
        ) {
            revert InvalidDelegation();
        }
    }

    function _ownerOf(address account) internal view returns (address owner) {
        try IHybridOwner(account).owner() returns (address owner_) {
            owner = owner_;
        } catch {
            owner = address(0);
        }
    }

    function _addressFromPackedBytes(bytes memory data) internal pure returns (address addr) {
        assembly {
            addr := shr(96, mload(add(data, 32)))
        }
    }

    function _recoveryCommandTemplate() internal pure returns (string[] memory template) {
        template = new string[](7);
        template[0] = "Recover";
        template[1] = "account";
        template[2] = "{ethAddr}";
        template[3] = "to";
        template[4] = "new";
        template[5] = "owner";
        template[6] = "{ethAddr}";
    }
}
