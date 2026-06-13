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
