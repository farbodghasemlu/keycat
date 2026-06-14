import type { UnlockedKeystore } from "@keycat/keystore";
import { getKeycatChain } from "@keycat/shared";
import {
  CaveatType,
  Implementation,
  ScopeType,
  createDelegation,
  getSmartAccountsEnvironment,
  toMetaMaskSmartAccount,
  type Caveats,
  type Delegation,
  type MetaMaskSmartAccount
} from "@metamask/smart-accounts-kit";
import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  http,
  toHex,
  zeroAddress,
  type Chain,
} from "viem";
import { createBundlerClient } from "viem/account-abstraction";
import {
  generatePrivateKey,
  privateKeyToAccount,
  type PrivateKeyAccount
} from "viem/accounts";
import {
  createSignedAiReviewDelegation,
  probeAiReviewScope,
  requestVeniceAiReview,
  resolveAiReviewWithTimeout
} from "./ai-review.js";
import {
  isOneShotTerminalStatus,
  oneShotStatusState,
  OneShotRelayerClient,
  type OneShotAuthorizationListEntry,
  type OneShotDelegation7710,
  type OneShotExecution7710,
  type OneShotStatus
} from "./oneshot.js";
import type {
  KeycatAddress,
  KeycatAiReviewDelegationScope,
  KeycatAiReviewOptions,
  KeycatAiReviewRequest,
  KeycatAiReviewResult,
  KeycatAiReviewStatus,
  KeycatChainConfig,
  KeycatGaslessStatus,
  KeycatHex,
  KeycatRecoveryConfigureOptions,
  KeycatRecoveryStatus,
  KeycatSigner,
  KeycatSignerMode,
  KeycatSignerSnapshot,
  KeycatSignableMessage,
  KeycatSmartAccountImplementation,
  KeycatTransactionRequest,
  KeycatTypedDataPayload
} from "./types.js";

export type {
  KeycatSigner,
  KeycatSignerSnapshot,
  KeycatTransactionRequest,
  KeycatTypedDataPayload
} from "./types.js";

const DEFAULT_DEPLOY_SALT = "0x" as const;
const DEFAULT_GASLESS_TTL_SECONDS = 15 * 60;
const DEFAULT_RELAYER_POLL_MS = 2_500;
const RECOVERY_CONTROLLER_ABI = [
  {
    type: "function",
    name: "configureRecovery",
    inputs: [
      { name: "account", type: "address" },
      { name: "emailGuardianCommitment", type: "bytes32" },
      { name: "timelockSeconds", type: "uint256" },
      { name: "permissionContext", type: "bytes" }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "cancelRecovery",
    inputs: [{ name: "account", type: "address" }],
    outputs: [],
    stateMutability: "nonpayable"
  }
] as const;

const DELEGATION_ARRAY_ABI = {
  type: "tuple[]",
  components: [
    { name: "delegate", type: "address" },
    { name: "delegator", type: "address" },
    { name: "authority", type: "bytes32" },
    {
      name: "caveats",
      type: "tuple[]",
      components: [
        { name: "enforcer", type: "address" },
        { name: "terms", type: "bytes" },
        { name: "args", type: "bytes" }
      ]
    },
    { name: "salt", type: "uint256" },
    { name: "signature", type: "bytes" }
  ]
} as const;

export type KeycatSignerOptions = {
  rpcUrl?: string;
  bundlerUrl?: string;
  oneShotRelayerUrl?: string;
  oneShotWebhookUrl?: string;
  accountAddress?: KeycatAddress;
  gaslessTtlSeconds?: number;
  relayerPollMs?: number;
};

export type GaslessDelegationConfig = {
  scope:
    | {
        type: ScopeType.NativeTokenTransferAmount;
        maxAmount: bigint;
        exactCalldata?: { calldata: KeycatHex };
      }
    | {
        type: ScopeType.FunctionCall;
        targets: KeycatAddress[];
        selectors: KeycatHex[];
        valueLte: { maxValue: bigint };
        exactCalldata: { calldata: KeycatHex };
      };
  caveats: Caveats;
  expiresAt: number;
  valueCap: bigint;
  target: KeycatAddress;
};

type SmartAccountInstance =
  | MetaMaskSmartAccount<Implementation.Hybrid>
  | MetaMaskSmartAccount<Implementation.Stateless7702>;

export class PlainEoaSigner implements KeycatSigner {
  readonly address: KeycatAddress;
  readonly signerAddress: KeycatAddress;
  readonly mode = "plain-eoa" satisfies KeycatSignerMode;

  constructor(
    private readonly unlocked: UnlockedKeystore,
    private readonly chain: KeycatChainConfig,
    private readonly rpcUrl?: string
  ) {
    this.address = privateKeyToAccount(this.unlocked.privateKey)
      .address as KeycatAddress;
    this.signerAddress = this.address;
  }

  async signPersonalMessage(message: KeycatSignableMessage): Promise<KeycatHex> {
    const account = privateKeyToAccount(this.unlocked.privateKey);
    return account.signMessage({ message }) as Promise<KeycatHex>;
  }

  async signTypedData(payload: KeycatTypedDataPayload): Promise<KeycatHex> {
    const account = privateKeyToAccount(this.unlocked.privateKey);
    return account.signTypedData(payload as never) as Promise<KeycatHex>;
  }

  async sendTransaction(transaction: KeycatTransactionRequest): Promise<KeycatHex> {
    const account = privateKeyToAccount(this.unlocked.privateKey);
    const walletClient = createWalletClient({
      account,
      chain: this.chain as Chain,
      transport: http(this.rpcUrl)
    });
    return walletClient.sendTransaction(transaction as never) as Promise<KeycatHex>;
  }

  getSnapshot(): KeycatSignerSnapshot {
    return {
      address: this.address,
      signerAddress: this.signerAddress,
      mode: this.mode
    };
  }

  destroy(): void {
    this.unlocked.zeroize();
  }
}

abstract class BundledSmartAccountSigner implements KeycatSigner {
  readonly address: KeycatAddress;
  readonly signerAddress: KeycatAddress;
  abstract readonly mode: KeycatSignerMode;
  abstract readonly implementation: KeycatSmartAccountImplementation;
  private gasless?: KeycatGaslessStatus;
  private aiReview?: KeycatAiReviewStatus;
  private recovery?: KeycatRecoveryStatus;
  private aiReviewSession?: {
    scope: KeycatAiReviewDelegationScope;
    parentPermissionContext: Delegation[];
    sessionKey: PrivateKeyAccount;
    fetch?: typeof fetch;
  };
  private sessionKey?: PrivateKeyAccount;
  private destroyed = false;
  private pollTimer?: ReturnType<typeof setTimeout>;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly unlocked: UnlockedKeystore,
    protected readonly chain: KeycatChainConfig,
    protected readonly smartAccount: SmartAccountInstance,
    protected readonly ownerAccount: PrivateKeyAccount,
    protected readonly options: KeycatSignerOptions
  ) {
    this.address = smartAccount.address as KeycatAddress;
    this.signerAddress = ownerAccount.address as KeycatAddress;
  }

  async signPersonalMessage(message: KeycatSignableMessage): Promise<KeycatHex> {
    return this.smartAccount.signMessage({ message }) as Promise<KeycatHex>;
  }

  async signTypedData(payload: KeycatTypedDataPayload): Promise<KeycatHex> {
    return this.smartAccount.signTypedData(payload as never) as Promise<KeycatHex>;
  }

  async sendTransaction(transaction: KeycatTransactionRequest): Promise<KeycatHex> {
    if (this.gasless?.enabled) {
      return this.sendGaslessTransaction(transaction);
    }
    const bundlerClient = this.createBundlerClient();
    const sendUserOperation = bundlerClient.sendUserOperation as (
      parameters: unknown
    ) => Promise<KeycatHex>;
    const hash = await sendUserOperation({
      account: this.smartAccount as never,
      calls: [toSmartAccountCall(transaction)] as never,
      ...(transaction.maxFeePerGas !== undefined
        ? { maxFeePerGas: transaction.maxFeePerGas }
        : {}),
      ...(transaction.maxPriorityFeePerGas !== undefined
        ? { maxPriorityFeePerGas: transaction.maxPriorityFeePerGas }
        : {})
    });
    return hash as KeycatHex;
  }

  async setGaslessMode(enabled: boolean): Promise<void> {
    if (!enabled) {
      this.sessionKey = undefined;
      this.gasless = { enabled: false, state: "idle" };
      this.emit();
      return;
    }

    const relayer = this.createRelayerClient();
    const chainId = String(this.chain.id);
    const capability = (await relayer.getCapabilities([chainId]))[chainId];
    if (!capability?.targetAddress) {
      throw new Error(`1Shot relayer does not advertise chain ${chainId}.`);
    }

    this.sessionKey = privateKeyToAccount(generatePrivateKey());
    this.gasless = {
      enabled: true,
      state: "idle",
      delegateAddress: capability.targetAddress,
      sessionKeyAddress: this.sessionKey.address as KeycatAddress
    };
    this.emit();
  }

  async setAiReviewMode(
    enabled: boolean,
    options: KeycatAiReviewOptions = {}
  ): Promise<void> {
    if (!enabled) {
      this.aiReviewSession = undefined;
      this.aiReview = {
        enabled: false,
        state: "disabled",
        message: "AI transaction review is disabled."
      };
      this.emit();
      return;
    }

    this.aiReview = {
      enabled: true,
      state: "probing",
      message: "Checking the x402 payment scope."
    };
    this.emit();

    const scope =
      options.scope ??
      (await probeAiReviewScope({
        endpoint: options.endpoint,
        fetch: options.fetch
      }));
    const paymentAccountAddress = await this.getSmartAccountAddressForChain(
      scope.chainId
    );
    const sessionKey = privateKeyToAccount(generatePrivateKey());
    const parentDelegation = await createSignedAiReviewDelegation({
      privateKey: this.unlocked.privateKey,
      payerAddress: paymentAccountAddress,
      sessionKeyAddress: sessionKey.address as KeycatAddress,
      scope
    });

    this.aiReviewSession = {
      scope,
      parentPermissionContext: [parentDelegation],
      sessionKey,
      fetch: options.fetch
    };
    this.aiReview = {
      enabled: true,
      state: "ready",
      dailyUsdLimit: scope.dailyUsdLimit,
      payeeAddress: scope.payeeAddress,
      stablecoinAddress: scope.stablecoinAddress,
      payerAddress: paymentAccountAddress,
      sessionKeyAddress: sessionKey.address as KeycatAddress,
      chainId: scope.chainId,
      expiresAt: scope.expiresAt
    };
    this.emit();
  }

  async configureRecovery({
    controllerAddress,
    emailGuardianCommitment,
    timelockSeconds
  }: KeycatRecoveryConfigureOptions): Promise<KeycatRecoveryStatus> {
    if (this.implementation !== "Hybrid") {
      throw new Error("Recovery is only supported for Hybrid smart accounts.");
    }
    this.recovery = {
      enabled: false,
      state: "configuring",
      controllerAddress,
      emailGuardianCommitment,
      timelockSeconds,
      message: "Configuring recovery."
    };
    this.emit();

    const delegation = createDelegation({
      from: this.smartAccount.address as KeycatAddress,
      to: controllerAddress,
      environment: this.smartAccount.environment,
      scope: {
        type: ScopeType.OwnershipTransfer,
        contractAddress: this.smartAccount.address as KeycatAddress
      },
      salt: randomHex32()
    });
    const signature = await this.smartAccount.signDelegation({ delegation });
    const permissionContext = encodeDelegationPermissionContext({
      ...delegation,
      signature
    });
    const data = encodeFunctionData({
      abi: RECOVERY_CONTROLLER_ABI,
      functionName: "configureRecovery",
      args: [
        this.smartAccount.address as KeycatAddress,
        emailGuardianCommitment,
        BigInt(timelockSeconds),
        permissionContext
      ]
    });

    await this.sendTransaction({
      to: controllerAddress,
      data
    });

    this.recovery = {
      enabled: true,
      state: "enabled",
      controllerAddress,
      emailGuardianCommitment,
      timelockSeconds,
      message: `Recovery enabled with a ${formatDuration(timelockSeconds)} timelock.`
    };
    this.emit();
    return this.recovery;
  }

  async cancelRecovery(controllerAddress: KeycatAddress): Promise<KeycatHex> {
    const data = encodeFunctionData({
      abi: RECOVERY_CONTROLLER_ABI,
      functionName: "cancelRecovery",
      args: [this.smartAccount.address as KeycatAddress]
    });
    this.recovery = {
      ...(this.recovery ?? { enabled: true }),
      enabled: true,
      state: "executing",
      controllerAddress,
      message: "Cancelling recovery."
    };
    this.emit();
    const hash = await this.sendTransaction({
      to: controllerAddress,
      data
    });
    this.recovery = {
      ...(this.recovery ?? { enabled: true }),
      enabled: true,
      state: "enabled",
      controllerAddress,
      message: "Recovery request cancelled."
    };
    this.emit();
    return hash;
  }

  async reviewWithAi(request: KeycatAiReviewRequest): Promise<KeycatAiReviewResult> {
    const session = this.aiReviewSession;
    if (!session || this.aiReview?.state !== "ready") {
      return request.local;
    }
    const abort = new AbortController();
    const review = requestVeniceAiReview({
      request,
      scope: session.scope,
      parentPermissionContext: session.parentPermissionContext,
      sessionAccount: session.sessionKey,
      fetch: session.fetch,
      signal: abort.signal
    });
    const result = await resolveAiReviewWithTimeout({
      local: request.local,
      review
    });
    if (result.status === "unavailable") {
      abort.abort();
    }
    return result;
  }

  getSnapshot(): KeycatSignerSnapshot {
    return {
      address: this.address,
      signerAddress: this.signerAddress,
      mode: this.mode,
      implementation: this.implementation,
      ...(this.gasless ? { gasless: { ...this.gasless } } : {}),
      ...(this.aiReview ? { aiReview: { ...this.aiReview } } : {}),
      ...(this.recovery ? { recovery: { ...this.recovery } } : {})
    };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  destroy(): void {
    this.destroyed = true;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
    }
    this.listeners.clear();
    this.sessionKey = undefined;
    this.aiReviewSession = undefined;
    this.unlocked.zeroize();
  }

  private createBundlerClient() {
    if (!this.options.bundlerUrl) {
      throw new Error("NEXT_PUBLIC_BUNDLER_URL is required for smart-account transactions.");
    }
    const publicClient = createPublicClient({
      chain: this.chain as Chain,
      transport: http(this.options.rpcUrl)
    });
    return createBundlerClient({
      client: publicClient,
      transport: http(this.options.bundlerUrl)
    });
  }

  private createRelayerClient(): OneShotRelayerClient {
    return new OneShotRelayerClient(this.options.oneShotRelayerUrl ?? "");
  }

  private async getSmartAccountAddressForChain(
    chainId: number
  ): Promise<KeycatAddress> {
    if (chainId === this.chain.id) {
      return this.address;
    }
    const chain = getKeycatChain(chainId);
    const publicClient = createPublicClient({
      chain: chain as Chain,
      transport: http()
    });
    if (this.implementation === "Stateless7702") {
      const smartAccount = await toMetaMaskSmartAccount({
        client: publicClient,
        implementation: Implementation.Stateless7702,
        address: this.ownerAccount.address,
        signer: { account: this.ownerAccount }
      });
      return smartAccount.address as KeycatAddress;
    }
    const smartAccount = await toMetaMaskSmartAccount({
      client: publicClient,
      implementation: Implementation.Hybrid,
      deployParams: [this.ownerAccount.address, [], [], []],
      deploySalt: DEFAULT_DEPLOY_SALT,
      signer: { account: this.ownerAccount }
    });
    return smartAccount.address as KeycatAddress;
  }

  private async sendGaslessTransaction(
    transaction: KeycatTransactionRequest
  ): Promise<KeycatHex> {
    const relayer = this.createRelayerClient();
    const chainId = String(this.chain.id);
    const capability = (await relayer.getCapabilities([chainId]))[chainId];
    if (!capability?.targetAddress) {
      throw new Error(`1Shot relayer does not advertise chain ${chainId}.`);
    }

    const expiresAt =
      Math.floor(Date.now() / 1000) +
      (this.options.gaslessTtlSeconds ?? DEFAULT_GASLESS_TTL_SECONDS);
    const { delegation, executions } = await this.createSignedDelegationBundle({
      transaction,
      delegateAddress: capability.targetAddress,
      expiresAt
    });
    const params = {
      chainId,
      transactions: [
        {
          permissionContext: [toOneShotDelegation(delegation)],
          executions
        }
      ],
      ...(this.options.oneShotWebhookUrl
        ? { destinationUrl: this.options.oneShotWebhookUrl }
        : {}),
      memo: `keycat:${this.address}:${Date.now()}`
    };

    const estimate = await relayer.estimate7710Transaction(params);
    if (!estimate.success) {
      throw new Error(estimate.error ?? "1Shot relayer rejected the delegated bundle estimate.");
    }
    const context = estimate.context ?? estimate.contextByChainId?.[chainId];
    const taskId = await relayer.send7710Transaction({
      ...params,
      ...(context ? { context } : {})
    });

    this.gasless = {
      enabled: true,
      state: "pending",
      taskId,
      delegateAddress: capability.targetAddress,
      sessionKeyAddress: this.sessionKey?.address as KeycatAddress | undefined,
      expiresAt
    };
    this.emit();
    this.pollRelayerStatus(relayer, taskId);
    return taskId;
  }

  private async createSignedDelegationBundle({
    transaction,
    delegateAddress,
    expiresAt
  }: {
    transaction: KeycatTransactionRequest;
    delegateAddress: KeycatAddress;
    expiresAt: number;
  }): Promise<{
    delegation: Delegation;
    executions: OneShotExecution7710[];
  }> {
    if (!transaction.to) {
      throw new Error("Gasless mode requires a target address.");
    }
    const config = buildGaslessDelegationConfig({
      transaction,
      expiresAt
    });
    const delegation = createDelegation({
      from: this.smartAccount.address as KeycatAddress,
      to: delegateAddress,
      environment: this.smartAccount.environment,
      scope: config.scope as never,
      caveats: config.caveats,
      salt: randomHex32()
    });
    const signature = await this.smartAccount.signDelegation({ delegation });
    const signedDelegation = {
      ...delegation,
      signature
    };
    return {
      delegation: signedDelegation,
      executions: [
        {
          target: transaction.to,
          value: toHex(transaction.value ?? 0n) as KeycatHex,
          data: transaction.data ?? "0x"
        }
      ]
    };
  }

  private pollRelayerStatus(relayer: OneShotRelayerClient, taskId: KeycatHex): void {
    const poll = async () => {
      if (this.destroyed) {
        return;
      }
      try {
        const status = await relayer.getStatus(taskId);
        this.applyRelayerStatus(status);
        if (!isOneShotTerminalStatus(status)) {
          this.pollTimer = setTimeout(
            poll,
            this.options.relayerPollMs ?? DEFAULT_RELAYER_POLL_MS
          );
        }
      } catch (error) {
        this.gasless = {
          ...(this.gasless ?? { enabled: true, state: "pending" }),
          enabled: true,
          state: "pending",
          taskId,
          message:
            error instanceof Error
              ? error.message
              : "Could not poll 1Shot relayer status."
        };
        this.emit();
        this.pollTimer = setTimeout(
          poll,
          this.options.relayerPollMs ?? DEFAULT_RELAYER_POLL_MS
        );
      }
    };
    this.pollTimer = setTimeout(poll, this.options.relayerPollMs ?? DEFAULT_RELAYER_POLL_MS);
  }

  private applyRelayerStatus(status: OneShotStatus): void {
    this.gasless = {
      ...(this.gasless ?? { enabled: true, state: "pending" }),
      enabled: true,
      state: oneShotStatusState(status),
      taskId: status.id,
      ...(status.status === 110 ? { transactionHash: status.hash } : {}),
      ...(status.status === 200
        ? { transactionHash: status.receipt.transactionHash }
        : {}),
      ...(status.status === 400 || status.status === 500
        ? { message: status.message ?? "1Shot relayer execution failed." }
        : {})
    };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export class SmartAccountSigner extends BundledSmartAccountSigner {
  readonly mode = "smart-account" satisfies KeycatSignerMode;
  readonly implementation = "Hybrid" satisfies KeycatSmartAccountImplementation;
}

export class Upgraded7702Signer extends BundledSmartAccountSigner {
  readonly mode = "eip7702" satisfies KeycatSignerMode;
  readonly implementation = "Stateless7702" satisfies KeycatSmartAccountImplementation;
}

export async function createSmartAccountSigner(
  unlocked: UnlockedKeystore,
  chain: KeycatChainConfig,
  options: KeycatSignerOptions = {}
): Promise<SmartAccountSigner> {
  const owner = privateKeyToAccount(unlocked.privateKey);
  const publicClient = createPublicClient({
    chain: chain as Chain,
    transport: http(options.rpcUrl)
  });
  const smartAccount = await toMetaMaskSmartAccount(
    options.accountAddress
      ? {
          client: publicClient,
          implementation: Implementation.Hybrid,
          address: options.accountAddress,
          signer: { account: owner }
        }
      : {
          client: publicClient,
          implementation: Implementation.Hybrid,
          deployParams: [owner.address, [], [], []],
          deploySalt: DEFAULT_DEPLOY_SALT,
          signer: { account: owner }
        }
  );
  return new SmartAccountSigner(unlocked, chain, smartAccount, owner, options);
}

export async function createUpgraded7702Signer(
  unlocked: UnlockedKeystore,
  chain: KeycatChainConfig,
  options: KeycatSignerOptions & { relayUpgrade?: boolean } = {}
): Promise<Upgraded7702Signer> {
  const owner = privateKeyToAccount(unlocked.privateKey);
  const publicClient = createPublicClient({
    chain: chain as Chain,
    transport: http(options.rpcUrl)
  });

  if (options.relayUpgrade) {
    await relay7702Authorization({
      owner,
      chain,
      rpcUrl: options.rpcUrl,
      relayerUrl: options.oneShotRelayerUrl
    });
  }

  const smartAccount = await toMetaMaskSmartAccount({
    client: publicClient,
    implementation: Implementation.Stateless7702,
    address: owner.address,
    signer: { account: owner }
  });
  return new Upgraded7702Signer(unlocked, chain, smartAccount, owner, options);
}

export function createPlainEoaSigner(
  unlocked: UnlockedKeystore,
  chain: KeycatChainConfig,
  rpcUrl?: string
): KeycatSigner {
  return new PlainEoaSigner(unlocked, chain, rpcUrl);
}

export const createLocalEoaSigner = createPlainEoaSigner;
export const LocalEoaKeycatSigner = PlainEoaSigner;

export function buildGaslessDelegationConfig({
  transaction,
  expiresAt
}: {
  transaction: KeycatTransactionRequest;
  expiresAt: number;
}): GaslessDelegationConfig {
  if (!transaction.to) {
    throw new Error("Gasless delegation requires a target address.");
  }
  const data = transaction.data ?? "0x";
  const valueCap = transaction.value ?? 0n;
  const caveats = [
    {
      type: CaveatType.AllowedTargets,
      targets: [transaction.to]
    },
    {
      type: CaveatType.ValueLte,
      maxValue: valueCap
    },
    {
      type: CaveatType.Timestamp,
      afterThreshold: 0,
      beforeThreshold: expiresAt
    }
  ] satisfies Caveats;

  if (data !== "0x") {
    return {
      scope: {
        type: ScopeType.FunctionCall,
        targets: [transaction.to],
        selectors: [data.slice(0, 10) as KeycatHex],
        valueLte: { maxValue: valueCap },
        exactCalldata: { calldata: data }
      },
      caveats,
      expiresAt,
      valueCap,
      target: transaction.to
    };
  }

  return {
    scope: {
      type: ScopeType.NativeTokenTransferAmount,
      maxAmount: valueCap,
      exactCalldata: { calldata: data }
    },
    caveats,
    expiresAt,
    valueCap,
    target: transaction.to
  };
}

export async function relay7702Authorization({
  owner,
  chain,
  rpcUrl,
  relayerUrl
}: {
  owner: PrivateKeyAccount;
  chain: KeycatChainConfig;
  rpcUrl?: string;
  relayerUrl?: string;
}): Promise<KeycatHex> {
  const environment = getSmartAccountsEnvironment(chain.id);
  const implementation = environment.implementations
    .EIP7702StatelessDeleGatorImpl as KeycatAddress | undefined;
  if (!implementation) {
    throw new Error(`MetaMask Smart Accounts Kit has no 7702 implementation for ${chain.id}.`);
  }
  const walletClient = createWalletClient({
    account: owner,
    chain: chain as Chain,
    transport: http(rpcUrl)
  });
  const authorization = await walletClient.signAuthorization({
    account: owner,
    contractAddress: implementation,
    executor: "self"
  });
  const relayer = new OneShotRelayerClient(relayerUrl ?? "");
  return relayer.sendTransaction({
    chainId: String(chain.id),
    payment: { type: "sponsored" },
    to: zeroAddress,
    data: "0x",
    authorizationList: [toOneShotAuthorization(authorization)]
  });
}

function toSmartAccountCall(transaction: KeycatTransactionRequest): {
  to: KeycatAddress;
  value?: bigint;
  data?: KeycatHex;
} {
  if (!transaction.to) {
    throw new Error("Smart-account transactions require a target address.");
  }
  return {
    to: transaction.to,
    ...(transaction.value !== undefined ? { value: transaction.value } : {}),
    ...(transaction.data !== undefined ? { data: transaction.data } : {})
  };
}

function toOneShotDelegation(delegation: Delegation): OneShotDelegation7710 {
  return {
    delegate: delegation.delegate as KeycatAddress,
    delegator: delegation.delegator as KeycatAddress,
    authority: delegation.authority as KeycatHex,
    caveats: delegation.caveats.map((caveat) => ({
      enforcer: caveat.enforcer as KeycatAddress,
      terms: caveat.terms as KeycatHex,
      args: caveat.args as KeycatHex
    })),
    salt: delegation.salt as KeycatHex,
    signature: delegation.signature as KeycatHex
  };
}

function encodeDelegationPermissionContext(delegation: Delegation): KeycatHex {
  return encodeAbiParameters(
    [DELEGATION_ARRAY_ABI],
    [
      [
        {
          delegate: delegation.delegate as KeycatAddress,
          delegator: delegation.delegator as KeycatAddress,
          authority: delegation.authority as KeycatHex,
          caveats: delegation.caveats.map((caveat) => ({
            enforcer: caveat.enforcer as KeycatAddress,
            terms: caveat.terms as KeycatHex,
            args: caveat.args as KeycatHex
          })),
          salt: BigInt(delegation.salt),
          signature: delegation.signature as KeycatHex
        }
      ]
    ]
  ) as KeycatHex;
}

function toOneShotAuthorization(authorization: {
  address: `0x${string}`;
  chainId: number;
  nonce: number;
  r: KeycatHex;
  s: KeycatHex;
  yParity?: number;
  v?: bigint | number;
}): OneShotAuthorizationListEntry {
  const yParity =
    authorization.yParity ??
    (authorization.v === 27n || authorization.v === 27
      ? 0
      : authorization.v === 28n || authorization.v === 28
        ? 1
        : 0);
  return {
    address: authorization.address as KeycatAddress,
    chainId: String(authorization.chainId),
    nonce: String(authorization.nonce),
    r: authorization.r,
    s: authorization.s,
    yParity: String(yParity)
  };
}

function randomHex32(): KeycatHex {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function formatDuration(seconds: number): string {
  if (seconds % 86400 === 0) {
    const days = seconds / 86400;
    return `${days} day${days === 1 ? "" : "s"}`;
  }
  if (seconds % 3600 === 0) {
    const hours = seconds / 3600;
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  return `${seconds} seconds`;
}
