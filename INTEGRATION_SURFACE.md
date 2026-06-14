# INTEGRATION_SURFACE

This is the public surface for a presentational dashboard. Import from
`@keycat/wallet-ui` unless a section says `@keycat/shared`.

## Wallet UI Exports

### Component

```ts
function KeycatWallet(props: KeycatWalletProps): JSX.Element | null

type KeycatWalletProps = {
  mode: "embedded" | "fullpage"
  chain?: KeycatChainConfig
  chainId?: number
  rpcUrl?: string
  bundlerUrl?: string
  oneShotRelayerUrl?: string
  oneShotWebhookUrl?: string
  veniceX402Endpoint?: string
  recoveryControllerAddress?: string
  demoMockRecovery?: boolean
  autoLockMs?: number
  lockOnVisibilityHidden?: boolean
  transport?: KeycatWalletTransport
}
```

`KeycatWallet` owns create/unlock/recover/settings/confirmation flows. It keeps
decrypted key material inside wallet-ui memory only.

### Provider and State Hooks

```ts
function useKeycatProvider(options?: {
  chain?: KeycatChainConfig
  chainId?: number
  rpcUrl?: string
  publicRpc?: PublicRpcProxy
  signer?: KeycatSigner
  aiReviewEndpoint?: string
}): {
  controller: KeycatProviderController
  provider: KeycatProvider
  snapshot: KeycatControllerSnapshot
}
```

```ts
function useKeycatWalletState(options: {
  controller: KeycatProviderController
  origin?: string
}): {
  snapshot: KeycatControllerSnapshot
  isUnlocked: boolean
  account?: KeycatAddress
  signerAddress?: KeycatAddress
  signer?: KeycatSignerSnapshot
  pending?: KeycatPendingRequest
  activity: KeycatActivityLogEntry[]
  lock(message?: string): void
  requestAccounts(): Promise<KeycatAddress[]>
  signPersonalMessage(message: string): Promise<KeycatHex>
  signTypedData(payload: KeycatTypedDataPayload): Promise<KeycatHex>
  sendTransaction(transaction: KeycatTransactionRequest): Promise<KeycatHex>
  setGaslessMode(enabled: boolean): Promise<void>
  prepareAiReviewScope(): Promise<KeycatAiReviewDelegationScope>
  setAiReviewMode(enabled: boolean, scope?: KeycatAiReviewDelegationScope): Promise<void>
  cancelRecovery(controllerAddress: KeycatAddress): Promise<KeycatHex>
}
```

`KeycatControllerSnapshot`:

```ts
type KeycatControllerSnapshot = {
  address?: KeycatAddress
  signer?: KeycatSignerSnapshot
  isUnlocked: boolean
  pending?: KeycatPendingRequest
  activity: KeycatActivityLogEntry[]
}
```

`KeycatSignerSnapshot` includes `address`, `signerAddress`, `mode`,
`implementation`, and optional `gasless`, `aiReview`, and `recovery` status
objects.

### Read Functions and Read Hooks

All read hooks return:

```ts
type KeycatReadHookResult<T> = {
  data?: T
  loading: boolean
  error?: Error
  refresh(): void
}
```

Balances:

```ts
function readNativeBalance(args: {
  chain: KeycatChainConfig
  rpcUrl?: string
  account: KeycatAddress
}): Promise<{ account: KeycatAddress; balance: bigint; symbol?: string; decimals?: number }>

function useNativeBalance(args: {
  chain: KeycatChainConfig
  rpcUrl?: string
  account?: KeycatAddress
}): KeycatReadHookResult<KeycatNativeBalance>
```

```ts
type KeycatBalanceToken = {
  chainId: number
  address: KeycatAddress
  symbol: string
  decimals: number
  name?: string
}

function readErc20Balances(args: {
  chain: KeycatChainConfig
  rpcUrl?: string
  account: KeycatAddress
  tokens: KeycatBalanceToken[]
}): Promise<KeycatErc20Balance[]>

function useErc20Balances(args: {
  chain: KeycatChainConfig
  rpcUrl?: string
  account?: KeycatAddress
  tokens: KeycatBalanceToken[]
}): KeycatReadHookResult<KeycatErc20Balance[]>
```

Delegations/session keys:

```ts
function readActiveDelegations(snapshot?: Pick<KeycatControllerSnapshot, "signer">): KeycatActiveDelegation[]
function useActiveDelegations(snapshot?: Pick<KeycatControllerSnapshot, "signer">): KeycatActiveDelegation[]

type KeycatActiveDelegation = {
  id: string
  kind: "gasless" | "ai-review"
  state: string
  delegateAddress?: KeycatAddress
  sessionKeyAddress?: KeycatAddress
  payerAddress?: KeycatAddress
  payeeAddress?: KeycatAddress
  stablecoinAddress?: KeycatAddress
  chainId?: number
  dailyUsdLimit?: string
  expiresAt?: number
}
```

These are in-memory session/delegation statuses. Keycat does not run an indexer
and does not persist historical delegation state after lock.

Recovery:

```ts
function readRecoveryStatus(args: {
  chain: KeycatChainConfig
  rpcUrl?: string
  controllerAddress: KeycatAddress
  account: KeycatAddress
  now?: number
}): Promise<{
  controllerAddress: KeycatAddress
  account: KeycatAddress
  config: RecoveryConfig
  pending: PendingRecovery
  canCancel: boolean
}>

function useRecoveryStatus(args: {
  chain: KeycatChainConfig
  rpcUrl?: string
  controllerAddress?: KeycatAddress
  account?: KeycatAddress
}): KeycatReadHookResult<KeycatRecoveryReadStatus>
```

`cancelRecovery(controllerAddress)` is exposed on `useKeycatWalletState` and
`KeycatProviderController`.

Activity log:

```ts
function readActivityLog(snapshot?: Pick<KeycatControllerSnapshot, "activity">): KeycatActivityLogEntry[]
function useKeycatActivityLog(snapshot?: Pick<KeycatControllerSnapshot, "activity">): KeycatActivityLogEntry[]

type KeycatActivityLogEntry = {
  id: string
  createdAt: number
  origin: string
  method: string
  kind: "connect" | "personal_sign" | "eth_signTypedData_v4" | "eth_sendTransaction"
  status: "approved" | "rejected"
  result?: string
  error?: string
}
```

The activity log is current-session memory only and clears on lock.

### Recovery Helpers

```ts
function createRecoveryCommitment(args: {
  account: KeycatAddress
  email: string
}): Promise<{ accountCode: KeycatHex; accountSalt: KeycatHex }>

function deriveRecoveryAccountSalt(args: {
  email: string
  accountCode: KeycatHex
}): Promise<KeycatHex>
```

These use `@zk-email/relayer-utils` wasm helpers. They do not call
`/getAccountSalt`.

### Controller and Transport Exports

Also exported: `ProviderRpcError`, `createKeycatController`,
`serializeProviderError`, `createAutoLockController`, signer constructors
(`PlainEoaSigner`, `SmartAccountSigner`, `Upgraded7702Signer`,
`createPlainEoaSigner`, `createSmartAccountSigner`, `createUpgraded7702Signer`),
`buildGaslessDelegationConfig`, and widget transport helpers
`readKeycatWidgetConfig`, `createKeycatWindowTransport`,
`KEYCAT_SDK_SOURCE`, `KEYCAT_WIDGET_SOURCE`.

## EIP-1193 Provider

`KeycatProvider`:

```ts
type KeycatProvider = {
  request(args: { method: string; params?: unknown }, context?: { origin?: string }): Promise<unknown>
  on(event: "accountsChanged" | "disconnect", listener: (...args: unknown[]) => void): void
  removeListener(event: "accountsChanged" | "disconnect", listener: (...args: unknown[]) => void): void
}
```

Supported local methods:

- `eth_chainId` -> `0x${string}`
- `net_version` -> decimal chain id string
- `eth_accounts` -> `KeycatAddress[]`
- `eth_requestAccounts` -> confirmation, then `KeycatAddress[]`
- `personal_sign` -> confirmation, then `KeycatHex`
- `eth_signTypedData_v4` -> confirmation, then `KeycatHex`
- `eth_sendTransaction` -> confirmation, then `KeycatHex`

Read-only methods proxied to `publicRpc`/viem: `eth_blockNumber`, `eth_call`,
`eth_estimateGas`, `eth_feeHistory`, `eth_gasPrice`, `eth_getBalance`,
`eth_getBlockByHash`, `eth_getBlockByNumber`, `eth_getBlockReceipts`,
`eth_getCode`, `eth_getFilterChanges`, `eth_getFilterLogs`, `eth_getLogs`,
`eth_getProof`, `eth_getStorageAt`, `eth_getTransactionByHash`,
`eth_getTransactionByBlockHashAndIndex`,
`eth_getTransactionByBlockNumberAndIndex`, `eth_getTransactionCount`,
`eth_getTransactionReceipt`, `eth_getUncleByBlockHashAndIndex`,
`eth_getUncleByBlockNumberAndIndex`, `eth_getUncleCountByBlockHash`,
`eth_getUncleCountByBlockNumber`, `eth_maxPriorityFeePerGas`, `eth_syncing`,
`net_listening`, `net_peerCount`, `web3_clientVersion`.

Events:

- `accountsChanged(accounts: KeycatAddress[])`
- `disconnect(error: { code: 4900; message: string })`

Error codes:

- `4001`: user rejected or wallet locked during a pending request
- `4100`: unlock/account authorization required, or requested account mismatch
- `4200`: unsupported method/capability
- `4900`: disconnected/bridge closed
- `4901`: wrong chain for a transaction
- `-32002`: another interactive request is pending
- `-32602`: invalid params
- `-32603`: internal/request failure

## Shared Exports

`@keycat/shared` exports:

```ts
type KeycatChainName = "sepolia" | "base-sepolia" | "base"
const DEFAULT_KEYCAT_CHAIN_NAME: KeycatChainName
const DEFAULT_KEYCAT_CHAIN_ID: number
const KEYCAT_RECOVERY_CHAIN_NAME: KeycatChainName
const KEYCAT_RECOVERY_CHAIN_ID: number
const KEYCAT_CHAINS: Record<KeycatChainName, Chain>
const KEYCAT_CHAIN_OPTIONS: Chain[]
function getKeycatChain(selection?: KeycatChainName | number | null): Chain
function getKeycatChainFromEnvironment(value?: string | null): Chain
function chainIdToHex(chainId: number): `0x${string}`
```

Deployments:

```ts
type KeycatRecoveryDeployment = {
  chainId: typeof KEYCAT_RECOVERY_CHAIN_ID
  keycatRecoveryController: Address
  zkEmail: {
    verifier: Address
    userOverrideableDkimRegistry: Address
    emailAuth: Address
    relayer: Address
  }
  metamask: {
    delegationManager: Address
    ownershipTransferEnforcer: Address
    hybridDeleGatorImpl: Address
  }
}

const KEYCAT_RECOVERY_DEPLOYMENT: KeycatRecoveryDeployment
```

Curated token list:

```ts
type KeycatTokenListToken = {
  chainId: number
  address: Address
  symbol: string
  name: string
  decimals: number
  logoURI?: string
}

type KeycatTokenList = {
  name: string
  version: { major: number; minor: number; patch: number }
  tokens: KeycatTokenListToken[]
}

const KEYCAT_TOKEN_LIST: KeycatTokenList
```
