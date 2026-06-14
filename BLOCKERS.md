# BLOCKERS

## 1Shot ERC-7710 delegate address shape

- Date: 2026-06-13
- Source: `https://1shotapi.com/docs/quickstarts/gas-sponsorship-eip7710` and
  `https://1shotapi.com/openrpc/openrpc.json`

The requested design says gasless mode delegates to a fresh in-memory session
key, then the widget submits the delegated execution through 1Shot.

The current 1Shot public relayer OpenRPC surface for
`relayer_send7710Transaction` accepts `permissionContext` and `executions`, but
does not include a field for an arbitrary session-key signature or delegate
wallet credential. The 1Shot quickstart instead describes using the relayer's
advertised stable delegate/target address from capabilities.

Implemented closest real alternative: Keycat generates a fresh in-memory session
key for the local gasless session state, but the ERC-7710 delegation submitted to
1Shot delegates to the relayer capability `targetAddress`, with target, value
cap, and expiry caveats. This keeps the production payload compatible with the
documented relayer API and avoids faking a session-key redemption path.

## Venice x402 endpoint shape

- Date: 2026-06-14
- Sources:
  - `https://docs.venice.ai/guides/integrations/x402-venice-api`
  - `https://docs.metamask.io/smart-accounts-kit/guides/x402/buyer/delegations/`
  - `https://docs.metamask.io/smart-accounts-kit/guides/x402/seller/`
  - `venice-x402-client@0.2.0`

Venice's public x402 guide currently documents wallet authentication with
`X-Sign-In-With-X` plus a prepaid USDC balance/top-up route. It does not document
`POST /api/v1/chat/completions` returning the MetaMask Smart Accounts Kit style
HTTP 402 challenge with `extra.assetTransferMethod = "erc7710"` for per-request
delegated settlement.

Final split:

- Venice inference: Keycat signs a fresh SIWE message for the smart account and
  calls `POST https://api.venice.ai/api/v1/chat/completions` with
  `X-Sign-In-With-X`. The AI review summary/risks shown in the UI are parsed
  from this Venice response.
- Reference-seller x402+7710 rail: Keycat still probes and pays
  `NEXT_PUBLIC_VENICE_X402_ENDPOINT` through `@x402/fetch`, `@metamask/x402`,
  and `createx402DelegationProvider`. That endpoint should remain the
  MetaMask-compatible reference seller/facilitator for the ERC-7710 track; its
  response body is not used as the review text.

Remaining gap: Venice's documented `venice-x402-client@0.2.0` top-up helper is
EOA-private-key based. It does not expose a documented smart-account/ERC-7710
top-up payment header. Keycat therefore cannot safely auto-top-up Venice's
prepaid balance from a MetaMask smart account without inventing an unsupported
payment flow. Users need an already-funded Venice x402 balance for the
authenticated smart-account address, or Venice needs to document contract-account
or ERC-7710 top-up support.

Disabling AI review clears the in-memory session key and parent permission
context, so Keycat cannot create new payment payloads. Already submitted x402
payment payloads remain bounded by their per-request amount/payee/redeemer
caveats and expiry; there is no Keycat server-side storage to revoke.

## ZK Email recovery account-salt privacy

- Date: 2026-06-14
- Sources:
  - `https://docs.zk.email/account-recovery/api`
  - `github.com/zkemail/email-tx-builder/packages/relayer/src/handler.rs`
  - `github.com/zkemail/email-tx-builder/packages/relayer/src/schema.rs`
  - `@zk-email/relayer-utils@0.4.65`

Resolved the critical account-salt privacy issue. Keycat no longer calls
`POST /api/getAccountSalt` or the generic relayer `/api/accountSalt` endpoint.
The wallet now uses ZK Email's own `@zk-email/relayer-utils` wasm helpers:
`generateAccountCode()` and `generateAccountSalt(email, accountCode)`.

The plaintext recovery email is used locally for salt derivation and never POSTed
by Keycat. It never appears on-chain in plaintext. The ZK Email relayer sees the
email only when the user sends recovery mail to generate a proof, and it cannot
forge a valid proof without the DKIM-backed email/proof material.

Remaining recovery blocker: the non-mock UI still needs the full relayer proof
submission path wired. `DEMO_MOCK_RECOVERY` remains test/demo-only.

## KeycatRecoveryController adapter shape

- Date: 2026-06-14
- Sources:
  - `contracts/src/KeycatRecoveryController.sol`
  - `contracts/test/KeycatRecoveryController.t.sol`

The controller is not a thin inheritance adapter over ZK Email's upstream
`EmailAccountRecovery`; it implements adapter behavior locally: EmailAuth proxy
preparation, command-template checks, nullifier tracking, pending recovery
storage, timelock/cancel/execute flow, and Delegation Manager redemption.

Authorization does not appear loose in the current code:

- `configureRecovery` requires `msg.sender == account`.
- Recovery requests require the configured nonzero accountSalt, `isCodeExist`,
  unused nullifier, and `EmailAuth.authEmail(emailAuthMsg)`.
- Permission context validation requires one delegation from the recovered
  account to the controller, root authority, nonempty signature, and one
  ownership-transfer caveat whose terms encode the account.
- `cancelRecovery` is limited to the account or current owner before timelock
  expiry.
- `executeRecovery` only runs after the timelock and redeems the stored
  ownership-transfer delegation.

If the intended architecture strictly requires a thin wrapper around upstream
`EmailAccountRecovery`, this contract should be refactored in a dedicated
contract session rather than silently changed here.

## KeycatRecoveryController live address

- Date: 2026-06-14
- Sources:
  - `contracts/script/DeployKeycatRecoveryController.s.sol`
  - `packages/shared/src/deployments.ts`

The controller deploy script is pinned to Base Sepolia ZK Email and MetaMask
Delegation Framework deployments, but this session does not have a
`DEPLOYER_PRIVATE_KEY` or `BASE_SEPOLIA_RPC_URL` to broadcast with. As a result,
`packages/shared/src/deployments.ts` contains the external ZK Email/MetaMask
addresses and a zero placeholder for `keycatRecoveryController`.

After deployment, replace the zero placeholder and set
`NEXT_PUBLIC_RECOVERY_CONTROLLER_ADDRESS` to the deployed controller address.
