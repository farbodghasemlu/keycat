# @keycat/wallet-ui

React wallet implementation used by `/app` and `/widget`.

## Manual Chunk 2 Script

1. Run `pnpm dev:web`.
2. In another shell, run `pnpm dev:demo`.
3. Open the web wallet at `http://localhost:3000/app`.
4. Create a wallet, download `keycat-<addr>.json`, and confirm the address is shown.
5. Open KittySwap at `http://localhost:3001`.
6. Connect with the Keycat provider discovered through EIP-6963.
7. Sign the KittySwap message.
8. Fund the wallet on Sepolia, then send `0.0001 ETH` to self from KittySwap.
9. Use the USDC approve button and confirm the calldata in Keycat.
10. Lock Keycat, then unlock from the downloaded keystore file.

All signing and transaction submission happens inside the widget context. The SDK bridge only carries request data, results, and provider events.
