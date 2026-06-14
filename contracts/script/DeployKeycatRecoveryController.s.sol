// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../src/KeycatRecoveryController.sol";

interface VmScript {
    function envUint(string calldata name) external view returns (uint256);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

contract DeployKeycatRecoveryController {
    VmScript private constant vm = VmScript(address(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D));

    address private constant BASE_SEPOLIA_ZK_EMAIL_VERIFIER =
        0x3E5f29a7cCeb30D5FCD90078430CA110c2985716;
    address private constant BASE_SEPOLIA_ZK_EMAIL_USER_OVERRIDEABLE_DKIM =
        0x3D3935B3C030893f118a84C92C66dF1B9E4169d6;
    address private constant BASE_SEPOLIA_ZK_EMAIL_AUTH =
        0x2721a8eB83Ef105f7B30DAB4e8A4da97cD54f970;
    address private constant BASE_SEPOLIA_DELEGATION_MANAGER =
        0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3;
    address private constant BASE_SEPOLIA_OWNERSHIP_TRANSFER_ENFORCER =
        0x7EEf9734E7092032B5C56310Eb9BbD1f4A524681;

    function run() external returns (KeycatRecoveryController controller) {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        vm.startBroadcast(deployerKey);
        controller = new KeycatRecoveryController(
            BASE_SEPOLIA_ZK_EMAIL_VERIFIER,
            BASE_SEPOLIA_ZK_EMAIL_USER_OVERRIDEABLE_DKIM,
            BASE_SEPOLIA_ZK_EMAIL_AUTH,
            BASE_SEPOLIA_DELEGATION_MANAGER,
            BASE_SEPOLIA_OWNERSHIP_TRANSFER_ENFORCER
        );
        vm.stopBroadcast();
    }
}
