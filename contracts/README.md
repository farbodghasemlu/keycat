# Keycat Recovery Contracts

## Pinned Testnet

Recovery is pinned to Base Sepolia (`84532`) because ZK Email publishes its
account-recovery contracts and staging relayer for Base Sepolia.

Deploy with:

```sh
cd contracts
forge script script/DeployKeycatRecoveryController.s.sol \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --broadcast
```

The deploy script wires the controller to these Base Sepolia contracts:

- ZK Email `Verifier`: `0x3E5f29a7cCeb30D5FCD90078430CA110c2985716`
- ZK Email user-overridable DKIM registry: `0x3D3935B3C030893f118a84C92C66dF1B9E4169d6`
- ZK Email `EmailAuth` implementation: `0x2721a8eB83Ef105f7B30DAB4e8A4da97cD54f970`
- MetaMask DelegationManager: `0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3`
- MetaMask OwnershipTransferEnforcer: `0x7EEf9734E7092032B5C56310Eb9BbD1f4A524681`

## ZK Email Flow

`KeycatRecoveryController` follows ZK Email's `EmailAccountRecovery` pattern:

1. `configureRecovery(account, emailGuardianCommitment, timelockSeconds, permissionContext)`
   must be called by the account itself.
2. `emailGuardianCommitment` is the ZK Email `accountSalt`, a salted
   commitment derived from the recovery email and account code. The controller
   never accepts a plaintext email or an unsalted email hash.
3. `handleRecovery(EmailAuthMsg, 0)` authenticates the command through the
   deterministic `EmailAuth` proxy for `(account, accountSalt)`.
4. The recovery command template is:
   `Recover account {ethAddr} to new owner {ethAddr}`.
5. A verified email starts the timelock and emits
   `RecoveryRequested(account, newOwner, executeAfter)`.
6. The current account owner can cancel before `executeAfter`.
7. Anyone can call `executeRecovery(account)` after the timelock.

Source references checked before implementation:

- `zkemail/email-recovery/src/EmailAccountRecovery.sol`: deterministic
  `EmailAuth` proxy deployment, template IDs, and `handleRecovery`.
- `zkemail/email-tx-builder/packages/contracts/src/EmailAuth.sol`: DKIM,
  verifier, template, account-salt, nullifier, and timestamp checks.
- `zkemail/email-tx-builder/packages/contracts/src/interfaces/IEmailTypes.sol`:
  `EmailAuthMsg` shape.

## MetaMask Hybrid Owner Rotation

The Hybrid DeleGator source does not expose an unrestricted owner rotation
method. `HybridDeleGator.transferOwnership(address)` and
`HybridDeleGator.updateSigners(...)` are guarded by `onlyEntryPointOrSelf`.
Therefore the recovery controller cannot rotate ownership with a direct call.

During `configureRecovery`, the account stores an owner-signed ERC-7710
delegation whose:

- `delegator` is the Hybrid account,
- `delegate` is the recovery controller,
- `authority` is `ROOT_AUTHORITY`,
- only caveat is `OwnershipTransferEnforcer`,
- caveat terms are the account address.

On execution, the controller calls MetaMask `DelegationManager.redeemDelegations`
with ERC-7579 `SingleDefault` mode and `ExecutionLib.encodeSingle(account, 0,
abi.encodeCall(transferOwnership, (newOwner)))`. The DelegationManager then
causes the Hybrid account to call itself, so `onlyEntryPointOrSelf` passes.

Source references checked before implementation:

- `metamask/delegation-framework/src/HybridDeleGator.sol`:
  `transferOwnership(address)` and `updateSigners(...)` are
  `onlyEntryPointOrSelf`.
- `metamask/delegation-framework/src/DeleGatorCore.sol`:
  `executeFromExecutor` is only callable by DelegationManager and performs the
  target execution.
- `metamask/delegation-framework/src/DelegationManager.sol`:
  `redeemDelegations` validates the delegation chain and calls
  `executeFromExecutor`.
- `metamask/delegation-framework/src/enforcers/OwnershipTransferEnforcer.sol`:
  verifies single-call `transferOwnership(address)` against the caveat target.
- `erc7579/erc7579-implementation/src/lib/ExecutionLib.sol`:
  single execution encoding is `abi.encodePacked(target, value, callData)`.
