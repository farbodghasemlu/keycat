# @keycat/wallet-ui

React wallet implementation used by `/app` and `/widget`.

## Smart Account Runtime

- Default creation and unlock use a MetaMask Smart Accounts Kit Hybrid account.
  `eth_requestAccounts` returns the smart account address; the keystore EOA is
  shown separately as the signer.
- EIP-7702 creation signs an authorization for the Kit's Stateless7702
  implementation and submits it through the configured 1Shot public relayer.
- Gasless mode creates a scoped ERC-7710 delegation and submits it to 1Shot's
  public JSON-RPC relayer. Keycat polls `relayer_getStatus` in production
  because Keycat runs no backend infrastructure.
- `scripts/webhook-listener.ts` is local demo tooling only. It can receive
  1Shot webhooks for recordings, but it is not imported by any app and must not
  be deployed.

Required public endpoints:

- `NEXT_PUBLIC_BUNDLER_URL`: ERC-4337 bundler RPC for the selected chain.
- `NEXT_PUBLIC_ONESHOT_RELAYER_URL`: 1Shot JSON-RPC endpoint, for example
  `https://relayer.1shotapi.dev/relayers` on testnet.
- `NEXT_PUBLIC_ONESHOT_WEBHOOK_URL`: optional local demo webhook URL only.
- `NEXT_PUBLIC_VENICE_X402_ENDPOINT`: x402-protected AI review endpoint. It
  must advertise an ERC-7710 EVM payment option; see `BLOCKERS.md` for the
  current Venice public-docs delta.

## Manual Chunk 3/4 Script

1. Run `pnpm dev:web`.
2. In another shell, run `pnpm dev:demo`.
3. Open the web wallet at `http://localhost:3000/app`.
4. Create a wallet, download `keycat-<addr>.json`, and confirm account and
   signer addresses are shown.
5. Open KittySwap at `http://localhost:3001`.
6. Connect with the Keycat provider discovered through EIP-6963.
7. Sign the KittySwap message.
8. Send `0.0001 ETH` to self from KittySwap; this submits through the smart
   account bundler and deploys the account on first use.
9. Enable gasless mode in Keycat, then use the USDC approve button and confirm
   the calldata; Keycat submits the delegated execution through 1Shot and polls
   pending to terminal status.
10. Enable AI transaction review in Keycat, approve the displayed `$0.25/day`
   x402 delegation scope, then trigger KittySwap's USDC approve. The
   confirmation should show an explanation, an "Unlimited token approval" flag,
   and the x402 price when the endpoint returns a payment receipt.
11. Disable AI transaction review and trigger the approve flow again. The
   confirmation should return to the plain local flow with no AI review session
   in memory.
12. Create a second wallet with "Upgrade my key in place (EIP-7702)" and verify
   the authorization task through 1Shot before sending from the upgraded account.
13. Lock Keycat, then unlock from the downloaded keystore file.

All signing and transaction submission happens inside the widget context. The SDK bridge only carries request data, results, and provider events.
