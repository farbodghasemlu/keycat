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

Venice's public x402 guide currently documents wallet authentication with
`X-Sign-In-With-X` plus a prepaid USDC balance/top-up route. It does not document
`POST /api/v1/chat/completions` returning the MetaMask Smart Accounts Kit style
HTTP 402 challenge with `extra.assetTransferMethod = "erc7710"` for per-request
delegated settlement.

Implemented the real MetaMask/x402 buyer flow against
`NEXT_PUBLIC_VENICE_X402_ENDPOINT`: Keycat probes that endpoint for a 402
challenge, scopes the parent ERC-7710 delegation to the returned network, USDC
asset, and `payTo`, then pays each review through `@x402/fetch`,
`@metamask/x402`, and `createx402DelegationProvider`. Until Venice exposes a
compatible live inference endpoint, point `NEXT_PUBLIC_VENICE_X402_ENDPOINT` at
an x402 seller endpoint built from the MetaMask ERC-7710 seller/facilitator
example. The payment rail remains real; only the payee endpoint differs.

Disabling AI review clears the in-memory session key and parent permission
context, so Keycat cannot create new payment payloads. Already submitted x402
payment payloads remain bounded by their per-request amount/payee/redeemer
caveats and expiry; there is no Keycat server-side storage to revoke.
