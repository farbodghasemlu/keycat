import { chainIdToHex } from "@keycat/shared";
import {
  createPublicClient,
  http,
  isAddress,
  isHex,
  type Chain,
} from "viem";
import {
  createLocalTransactionReview,
  createLocalTypedDataReview,
  probeAiReviewScope,
  toLoadingAiReview
} from "./ai-review.js";
import type {
  KeycatAddress,
  KeycatAiReviewDelegationScope,
  KeycatAiReviewRequest,
  KeycatAiReviewResult,
  KeycatChainConfig,
  KeycatHex,
  KeycatSigner,
  KeycatSignerSnapshot,
  KeycatTransactionRequest,
  KeycatTypedDataPayload,
  PublicRpcProxy
} from "./types.js";

export type KeycatRequestArguments = {
  method: string;
  params?: unknown;
};

export type KeycatRequestContext = {
  origin?: string;
};

export type KeycatProviderEvent = "accountsChanged" | "disconnect";

export type KeycatProviderEventListener = (...args: unknown[]) => void;

export type KeycatProvider = {
  request(args: KeycatRequestArguments, context?: KeycatRequestContext): Promise<unknown>;
  on(event: KeycatProviderEvent, listener: KeycatProviderEventListener): void;
  removeListener(event: KeycatProviderEvent, listener: KeycatProviderEventListener): void;
};

export type ConfirmationKind =
  | "connect"
  | "personal_sign"
  | "eth_signTypedData_v4"
  | "eth_sendTransaction";

export type ConfirmationDetail = {
  title: string;
  description: string;
  rows: { label: string; value: string }[];
  raw?: { label: string; value: string };
  aiReview?: KeycatAiReviewResult;
};

export type KeycatPendingRequest = {
  id: number;
  kind: ConfirmationKind;
  method: string;
  origin: string;
  status: "needs-wallet" | "confirm" | "executing";
  detail: ConfirmationDetail;
};

export type KeycatControllerSnapshot = {
  address?: KeycatAddress;
  signer?: KeycatSignerSnapshot;
  isUnlocked: boolean;
  pending?: KeycatPendingRequest;
};

export type KeycatControllerOptions = {
  chain: KeycatChainConfig;
  rpcUrl?: string;
  publicRpc?: PublicRpcProxy;
  signer?: KeycatSigner;
  aiReviewEndpoint?: string;
  aiReviewFetch?: typeof fetch;
};

type InternalPendingRequest = KeycatPendingRequest & {
  resolve(value: unknown): void;
  reject(error: ProviderRpcError): void;
  execute(signer: KeycatSigner): Promise<unknown>;
  aiReviewRequest?: KeycatAiReviewRequest;
  aiReviewStarted?: boolean;
};

type StateListener = () => void;

const READ_ONLY_RPC_METHODS = new Set([
  "eth_blockNumber",
  "eth_call",
  "eth_estimateGas",
  "eth_feeHistory",
  "eth_gasPrice",
  "eth_getBalance",
  "eth_getBlockByHash",
  "eth_getBlockByNumber",
  "eth_getBlockReceipts",
  "eth_getCode",
  "eth_getFilterChanges",
  "eth_getFilterLogs",
  "eth_getLogs",
  "eth_getProof",
  "eth_getStorageAt",
  "eth_getTransactionByBlockHashAndIndex",
  "eth_getTransactionByBlockNumberAndIndex",
  "eth_getTransactionByHash",
  "eth_getTransactionCount",
  "eth_getTransactionReceipt",
  "eth_getUncleByBlockHashAndIndex",
  "eth_getUncleByBlockNumberAndIndex",
  "eth_getUncleCountByBlockHash",
  "eth_getUncleCountByBlockNumber",
  "eth_maxPriorityFeePerGas",
  "eth_syncing",
  "net_listening",
  "net_peerCount",
  "net_version",
  "web3_clientVersion"
]);

const REJECTED_SIGNING_METHODS = new Set([
  "eth_sign",
  "eth_signTransaction",
  "eth_sendRawTransaction",
  "wallet_addEthereumChain",
  "wallet_switchEthereumChain",
  "wallet_watchAsset",
  "wallet_requestPermissions",
  "wallet_getPermissions"
]);

export class ProviderRpcError extends Error {
  readonly code: number;
  readonly data?: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "ProviderRpcError";
    this.code = code;
    this.data = data;
  }
}

export function serializeProviderError(error: unknown): {
  code: number;
  message: string;
  data?: unknown;
} {
  if (error instanceof ProviderRpcError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.data !== undefined ? { data: error.data } : {})
    };
  }
  if (error instanceof Error) {
    return { code: -32603, message: error.message };
  }
  return { code: -32603, message: "Request failed." };
}

export function createKeycatController(
  options: KeycatControllerOptions
): KeycatProviderController {
  return new KeycatProviderController(options);
}

export class KeycatProviderController implements KeycatProvider {
  readonly chain: KeycatChainConfig;
  readonly rpcUrl?: string;
  private signer?: KeycatSigner;
  private pending?: InternalPendingRequest;
  private pendingId = 0;
  private readonly publicRpc: PublicRpcProxy;
  private readonly aiReviewEndpoint?: string;
  private readonly aiReviewFetch?: typeof fetch;
  private readonly connectedOrigins = new Set<string>();
  private readonly stateListeners = new Set<StateListener>();
  private unsubscribeSigner?: () => void;
  private readonly providerListeners = new Map<
    KeycatProviderEvent,
    Set<KeycatProviderEventListener>
  >();
  private snapshot: KeycatControllerSnapshot;

  constructor({
    chain,
    rpcUrl,
    publicRpc,
    signer,
    aiReviewEndpoint,
    aiReviewFetch
  }: KeycatControllerOptions) {
    this.chain = chain;
    this.rpcUrl = rpcUrl;
    this.signer = signer;
    this.aiReviewEndpoint = aiReviewEndpoint;
    this.aiReviewFetch = aiReviewFetch;
    this.unsubscribeSigner = signer?.subscribe?.(() => this.emitState());
    this.publicRpc =
      publicRpc ??
      createPublicClient({
        chain: chain as Chain,
        transport: http(rpcUrl)
      }) as PublicRpcProxy;
    this.snapshot = this.createSnapshot();
  }

  getSnapshot(): KeycatControllerSnapshot {
    return this.snapshot;
  }

  subscribe(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  setSigner(signer: KeycatSigner): void {
    this.unsubscribeSigner?.();
    this.signer?.destroy();
    this.signer = signer;
    this.unsubscribeSigner = signer.subscribe?.(() => this.emitState());
    if (this.pending?.status === "needs-wallet") {
      this.pending.status = "confirm";
      this.startAiReviewForPending(this.pending);
    }
    this.emitState();
  }

  lock(message = "Wallet locked."): void {
    this.unsubscribeSigner?.();
    this.unsubscribeSigner = undefined;
    this.signer?.destroy();
    this.signer = undefined;
    this.connectedOrigins.clear();
    if (this.pending) {
      this.pending.reject(new ProviderRpcError(4001, message));
      this.pending = undefined;
    }
    this.emitProviderEvent("accountsChanged", []);
    this.emitProviderEvent("disconnect", { code: 4900, message });
    this.emitState();
  }

  async setGaslessMode(enabled: boolean): Promise<void> {
    if (!this.signer) {
      throw new ProviderRpcError(4100, "Unlock Keycat before changing gasless mode.");
    }
    if (!this.signer.setGaslessMode) {
      throw new ProviderRpcError(
        4200,
        "The current Keycat signer does not support gasless mode."
      );
    }
    await this.signer.setGaslessMode(enabled);
    this.emitState();
  }

  async prepareAiReviewScope(): Promise<KeycatAiReviewDelegationScope> {
    if (!this.signer) {
      throw new ProviderRpcError(4100, "Unlock Keycat before enabling AI review.");
    }
    return probeAiReviewScope({
      endpoint: this.aiReviewEndpoint,
      fetch: this.aiReviewFetch
    });
  }

  async setAiReviewMode(
    enabled: boolean,
    scope?: KeycatAiReviewDelegationScope
  ): Promise<void> {
    if (!this.signer) {
      throw new ProviderRpcError(4100, "Unlock Keycat before changing AI review.");
    }
    if (!this.signer.setAiReviewMode) {
      throw new ProviderRpcError(
        4200,
        "The current Keycat signer does not support AI transaction review."
      );
    }
    await this.signer.setAiReviewMode(enabled, {
      endpoint: this.aiReviewEndpoint,
      fetch: this.aiReviewFetch,
      ...(scope ? { scope } : {})
    });
    this.emitState();
  }

  async cancelRecovery(controllerAddress: KeycatAddress): Promise<KeycatHex> {
    if (!this.signer) {
      throw new ProviderRpcError(4100, "Unlock Keycat before cancelling recovery.");
    }
    if (!this.signer.cancelRecovery) {
      throw new ProviderRpcError(
        4200,
        "The current Keycat signer does not support recovery cancellation."
      );
    }
    const hash = await this.signer.cancelRecovery(controllerAddress);
    this.emitState();
    return hash;
  }

  async request(
    args: KeycatRequestArguments,
    context: KeycatRequestContext = {}
  ): Promise<unknown> {
    const origin = normalizeOrigin(context.origin);
    const params = normalizeParams(args.params);

    switch (args.method) {
      case "eth_chainId":
        return Promise.resolve(chainIdToHex(this.chain.id));
      case "net_version":
        return Promise.resolve(String(this.chain.id));
      case "eth_accounts":
        return Promise.resolve(this.getAccounts(origin));
      case "eth_requestAccounts":
        return this.requestConnect(origin);
      case "personal_sign":
        return this.requestPersonalSign(origin, params);
      case "eth_signTypedData_v4":
        return this.requestTypedData(origin, params);
      case "eth_sendTransaction":
        return this.requestSendTransaction(origin, params);
      default:
        if (
          REJECTED_SIGNING_METHODS.has(args.method) ||
          args.method.startsWith("wallet_")
        ) {
          throw new ProviderRpcError(
            4200,
            `${args.method} is not implemented by this Keycat signer.`
          );
        }
        if (READ_ONLY_RPC_METHODS.has(args.method)) {
          return this.publicRpc.request({
            method: args.method as never,
            params: params as never
          });
        }
        throw new ProviderRpcError(
          4200,
          `${args.method} is not supported by Keycat.`
        );
    }
  }

  on(event: KeycatProviderEvent, listener: KeycatProviderEventListener): void {
    const listeners = this.providerListeners.get(event) ?? new Set();
    listeners.add(listener);
    this.providerListeners.set(event, listeners);
  }

  removeListener(
    event: KeycatProviderEvent,
    listener: KeycatProviderEventListener
  ): void {
    this.providerListeners.get(event)?.delete(listener);
  }

  approvePending(): void {
    const pending = this.pending;
    const signer = this.signer;
    if (!pending) {
      return;
    }
    if (!signer) {
      pending.status = "needs-wallet";
      this.emitState();
      return;
    }

    pending.status = "executing";
    this.emitState();
    void pending
      .execute(signer)
      .then((result) => {
        pending.resolve(result);
      })
      .catch((error: unknown) => {
        pending.reject(
          error instanceof ProviderRpcError
            ? error
            : new ProviderRpcError(
                -32603,
                error instanceof Error ? error.message : "Request failed."
              )
        );
      })
      .finally(() => {
        if (this.pending?.id === pending.id) {
          this.pending = undefined;
          this.emitState();
        }
      });
  }

  rejectPending(message = "User rejected the request."): void {
    if (!this.pending) {
      return;
    }
    this.pending.reject(new ProviderRpcError(4001, message));
    this.pending = undefined;
    this.emitState();
  }

  private requestConnect(origin: string): Promise<unknown> {
    return this.enqueueInteractive({
      origin,
      method: "eth_requestAccounts",
      kind: "connect",
      detail: {
        title: "Connect to Keycat",
        description: "Share your wallet address with this site.",
        rows: [
          { label: "Site", value: origin },
          {
            label: "Account",
            value: this.signer?.address ?? "Unlock required"
          },
          {
            label: "Signer",
            value: this.signer?.signerAddress ?? "Unlock required"
          },
          { label: "Network", value: this.chain.name }
        ]
      },
      execute: async (signer) => {
        this.connectedOrigins.add(origin);
        const accounts = [signer.address];
        this.emitProviderEvent("accountsChanged", accounts);
        return accounts;
      }
    });
  }

  private requestPersonalSign(origin: string, params: unknown[]): Promise<unknown> {
    if (params.length < 1) {
      throw new ProviderRpcError(-32602, "personal_sign requires params.");
    }
    const { message, requestedAddress, humanMessage, rawHex } =
      parsePersonalSignParams(params);

    return this.enqueueInteractive({
      origin,
      method: "personal_sign",
      kind: "personal_sign",
      detail: {
        title: "Sign Message",
        description: humanMessage,
        rows: [
          { label: "Site", value: origin },
          {
            label: "Requested account",
            value: requestedAddress ?? "Current Keycat account"
          }
        ],
        ...(rawHex ? { raw: { label: "Message hex", value: rawHex } } : {})
      },
      execute: async (signer) => {
        assertRequestedAddress(signer.address, requestedAddress);
        this.connectedOrigins.add(origin);
        return signer.signPersonalMessage(message);
      }
    });
  }

  private requestTypedData(origin: string, params: unknown[]): Promise<unknown> {
    if (params.length < 2) {
      throw new ProviderRpcError(
        -32602,
        "eth_signTypedData_v4 requires address and typed data params."
      );
    }
    const { requestedAddress, typedData, raw } = parseTypedDataParams(params);
    const aiReviewRequest = this.createTypedDataAiReviewRequest({
      origin,
      typedData
    });

    return this.enqueueInteractive({
      origin,
      method: "eth_signTypedData_v4",
      kind: "eth_signTypedData_v4",
      detail: {
        title: "Sign Typed Data",
        description: `Primary type: ${typedData.primaryType}`,
        rows: [
          { label: "Site", value: origin },
          { label: "Requested account", value: requestedAddress },
          {
            label: "Domain",
            value: compactJson(typedData.domain ?? {})
          },
          { label: "Message", value: compactJson(typedData.message) }
        ],
        raw: { label: "Typed data JSON", value: raw },
        ...(aiReviewRequest
          ? { aiReview: toLoadingAiReview(aiReviewRequest.local) }
          : {})
      },
      aiReviewRequest,
      execute: async (signer) => {
        assertRequestedAddress(signer.address, requestedAddress);
        this.connectedOrigins.add(origin);
        return signer.signTypedData(typedData);
      }
    });
  }

  private requestSendTransaction(
    origin: string,
    params: unknown[]
  ): Promise<unknown> {
    if (params.length < 1 || !isRecord(params[0])) {
      throw new ProviderRpcError(
        -32602,
        "eth_sendTransaction requires a transaction object."
      );
    }
    const transaction = parseTransactionRequest(params[0]);
    const value = transaction.value ?? 0n;
    const aiReviewRequest = this.createTransactionAiReviewRequest({
      origin,
      transaction
    });

    return this.enqueueInteractive({
      origin,
      method: "eth_sendTransaction",
      kind: "eth_sendTransaction",
      detail: {
        title: "Send Transaction",
        description:
          transaction.data && transaction.data !== "0x"
            ? "Contract interaction"
            : "Native ETH transfer",
        rows: [
          { label: "Site", value: origin },
          { label: "From", value: transaction.from ?? "Current Keycat account" },
          { label: "To", value: transaction.to ?? "Contract creation" },
          { label: "Value", value: `${formatEth(value)} ETH` },
          { label: "Network", value: this.chain.name }
        ],
        ...(transaction.data && transaction.data !== "0x"
          ? { raw: { label: "Calldata", value: transaction.data } }
          : {}),
        ...(aiReviewRequest
          ? { aiReview: toLoadingAiReview(aiReviewRequest.local) }
          : {})
      },
      aiReviewRequest,
      execute: async (signer) => {
        assertRequestedAddress(signer.address, transaction.from);
        if (transaction.chainId !== undefined && transaction.chainId !== this.chain.id) {
          throw new ProviderRpcError(
            4901,
            `Keycat is connected to ${this.chain.name}, not chain ${transaction.chainId}.`
          );
        }
        const { from: _from, ...request } = transaction;
        this.connectedOrigins.add(origin);
        return signer.sendTransaction(request);
      }
    });
  }

  private enqueueInteractive({
    origin,
    method,
    kind,
    detail,
    aiReviewRequest,
    execute
  }: {
    origin: string;
    method: string;
    kind: ConfirmationKind;
    detail: ConfirmationDetail;
    aiReviewRequest?: KeycatAiReviewRequest;
    execute(signer: KeycatSigner): Promise<unknown>;
  }): Promise<unknown> {
    if (this.pending) {
      throw new ProviderRpcError(-32002, "A Keycat request is already pending.");
    }

    return new Promise((resolve, reject) => {
      this.pending = {
        id: ++this.pendingId,
        origin,
        method,
        kind,
        status: this.signer ? "confirm" : "needs-wallet",
        detail,
        aiReviewRequest,
        resolve,
        reject,
        execute
      };
      this.startAiReviewForPending(this.pending);
      this.emitState();
    });
  }

  private createTransactionAiReviewRequest({
    origin,
    transaction
  }: {
    origin: string;
    transaction: KeycatTransactionRequest;
  }): KeycatAiReviewRequest | undefined {
    if (this.signer?.getSnapshot?.().aiReview?.state !== "ready") {
      return undefined;
    }
    const chainId = transaction.chainId ?? this.chain.id;
    const local = createLocalTransactionReview({ transaction, chainId });
    return {
      kind: "transaction",
      origin,
      chainId,
      transaction,
      local
    };
  }

  private createTypedDataAiReviewRequest({
    origin,
    typedData
  }: {
    origin: string;
    typedData: KeycatTypedDataPayload;
  }): KeycatAiReviewRequest | undefined {
    if (this.signer?.getSnapshot?.().aiReview?.state !== "ready") {
      return undefined;
    }
    const chainId =
      typeof typedData.domain?.chainId === "number"
        ? typedData.domain.chainId
        : this.chain.id;
    const local = createLocalTypedDataReview({ typedData, chainId });
    return {
      kind: "typed-data",
      origin,
      chainId,
      typedData,
      local
    };
  }

  private startAiReviewForPending(pending: InternalPendingRequest): void {
    if (
      pending.aiReviewStarted ||
      !pending.aiReviewRequest ||
      pending.status === "needs-wallet" ||
      !this.signer?.reviewWithAi
    ) {
      return;
    }
    pending.aiReviewStarted = true;
    void this.signer
      .reviewWithAi(pending.aiReviewRequest)
      .then((review) => {
        if (this.pending?.id !== pending.id) {
          return;
        }
        pending.detail = {
          ...pending.detail,
          aiReview: review
        };
        this.emitState();
      })
      .catch(() => {
        if (this.pending?.id !== pending.id) {
          return;
        }
        pending.detail = {
          ...pending.detail,
          aiReview: {
            ...pending.aiReviewRequest!.local,
            status: "unavailable",
            notice: "AI review unavailable. Showing local decode only."
          }
        };
        this.emitState();
      });
  }

  private getAccounts(origin: string): KeycatAddress[] {
    if (!this.signer) {
      return [];
    }
    if (this.connectedOrigins.has(origin) || origin === "keycat://local") {
      return [this.signer.address];
    }
    return [];
  }

  private emitState(): void {
    this.snapshot = this.createSnapshot();
    for (const listener of this.stateListeners) {
      listener();
    }
  }

  private emitProviderEvent(event: KeycatProviderEvent, ...args: unknown[]): void {
    for (const listener of this.providerListeners.get(event) ?? []) {
      listener(...args);
    }
  }

  private createSnapshot(): KeycatControllerSnapshot {
    return {
      address: this.signer?.address,
      signer: this.signer
        ? this.signer.getSnapshot?.() ?? {
            address: this.signer.address,
            signerAddress: this.signer.signerAddress,
            mode: this.signer.mode,
            implementation: this.signer.implementation
          }
        : undefined,
      isUnlocked: this.signer !== undefined,
      pending: this.pending ? toPublicPending(this.pending) : undefined
    };
  }
}

function toPublicPending(pending: InternalPendingRequest): KeycatPendingRequest {
  return {
    id: pending.id,
    kind: pending.kind,
    method: pending.method,
    origin: pending.origin,
    status: pending.status,
    detail: pending.detail
  };
}

function normalizeOrigin(origin?: string): string {
  return origin && origin.length > 0 ? origin : "keycat://local";
}

function normalizeParams(params: unknown): unknown[] {
  if (params === undefined) {
    return [];
  }
  return Array.isArray(params) ? params : [params];
}

function parsePersonalSignParams(params: unknown[]): {
  message: string | { raw: KeycatHex };
  requestedAddress?: KeycatAddress;
  humanMessage: string;
  rawHex?: KeycatHex;
} {
  const first = params[0];
  const second = params[1];
  const requestedAddress =
    typeof first === "string" && isAddress(first)
      ? (first as KeycatAddress)
      : typeof second === "string" && isAddress(second)
        ? (second as KeycatAddress)
        : undefined;
  const messageInput =
    typeof first === "string" && isAddress(first) ? second : first;
  if (typeof messageInput !== "string") {
    throw new ProviderRpcError(-32602, "personal_sign message must be a string.");
  }
  if (isHex(messageInput)) {
    return {
      message: { raw: messageInput as KeycatHex },
      requestedAddress,
      humanMessage: decodeHexMessage(messageInput as KeycatHex),
      rawHex: messageInput as KeycatHex
    };
  }
  return {
    message: messageInput,
    requestedAddress,
    humanMessage: messageInput
  };
}

function parseTypedDataParams(params: unknown[]): {
  requestedAddress: KeycatAddress;
  typedData: KeycatTypedDataPayload;
  raw: string;
} {
  const first = params[0];
  const second = params[1];
  const requestedAddress =
    typeof first === "string" && isAddress(first)
      ? (first as KeycatAddress)
      : typeof second === "string" && isAddress(second)
        ? (second as KeycatAddress)
        : undefined;
  const dataInput =
    typeof first === "string" && isAddress(first) ? second : first;

  if (!requestedAddress) {
    throw new ProviderRpcError(
      -32602,
      "eth_signTypedData_v4 requires a valid address."
    );
  }

  let parsed: unknown;
  try {
    parsed = typeof dataInput === "string" ? JSON.parse(dataInput) : dataInput;
  } catch (error) {
    throw new ProviderRpcError(-32602, "Typed data is not valid JSON.", error);
  }
  if (!isRecord(parsed)) {
    throw new ProviderRpcError(
      -32602,
      "eth_signTypedData_v4 typed data must be an object."
    );
  }
  if (
    !isRecord(parsed.types) ||
    typeof parsed.primaryType !== "string" ||
    !isRecord(parsed.message)
  ) {
    throw new ProviderRpcError(
      -32602,
      "eth_signTypedData_v4 typed data is missing types, primaryType, or message."
    );
  }

  const typedData: KeycatTypedDataPayload = {
    domain: isRecord(parsed.domain) ? parsed.domain : {},
    types: parsed.types as KeycatTypedDataPayload["types"],
    primaryType: parsed.primaryType,
    message: parsed.message
  };
  return {
    requestedAddress,
    typedData,
    raw: JSON.stringify(typedData, null, 2)
  };
}

function parseTransactionRequest(input: Record<string, unknown>): KeycatTransactionRequest & {
  from?: KeycatAddress;
} {
  const from = parseOptionalAddress(input.from, "from");
  const to = parseOptionalAddress(input.to, "to");
  const data = parseOptionalHex(input.data, "data");
  return {
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(data ? { data } : {}),
    value: parseOptionalQuantity(input.value, "value"),
    gas: parseOptionalQuantity(input.gas ?? input.gasLimit, "gas"),
    gasPrice: parseOptionalQuantity(input.gasPrice, "gasPrice"),
    maxFeePerGas: parseOptionalQuantity(input.maxFeePerGas, "maxFeePerGas"),
    maxPriorityFeePerGas: parseOptionalQuantity(
      input.maxPriorityFeePerGas,
      "maxPriorityFeePerGas"
    ),
    nonce: parseOptionalNumber(input.nonce, "nonce"),
    chainId: parseOptionalNumber(input.chainId, "chainId")
  };
}

function parseOptionalAddress(value: unknown, name: string): KeycatAddress | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string" || !isAddress(value)) {
    throw new ProviderRpcError(-32602, `Transaction ${name} must be an address.`);
  }
  return value as KeycatAddress;
}

function parseOptionalHex(value: unknown, name: string): KeycatHex | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string" || !isHex(value)) {
    throw new ProviderRpcError(-32602, `Transaction ${name} must be hex.`);
  }
  return value as KeycatHex;
}

function parseOptionalQuantity(value: unknown, name: string): bigint | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value);
  }
  if (typeof value === "string" && isHex(value)) {
    return BigInt(value);
  }
  throw new ProviderRpcError(-32602, `Transaction ${name} must be a quantity.`);
}

function parseOptionalNumber(value: unknown, name: string): number | undefined {
  const quantity = parseOptionalQuantity(value, name);
  if (quantity === undefined) {
    return undefined;
  }
  const numeric = Number(quantity);
  if (!Number.isSafeInteger(numeric)) {
    throw new ProviderRpcError(-32602, `Transaction ${name} is too large.`);
  }
  return numeric;
}

function assertRequestedAddress(actual: KeycatAddress, requested?: KeycatAddress): void {
  if (requested && requested.toLowerCase() !== actual.toLowerCase()) {
    throw new ProviderRpcError(
      4100,
      "The requested account does not match the unlocked Keycat account."
    );
  }
}

function decodeHexMessage(hex: KeycatHex): string {
  const bytes: number[] = [];
  for (let index = 2; index < hex.length; index += 2) {
    bytes.push(Number.parseInt(hex.slice(index, index + 2), 16));
  }
  try {
    const decoded = new TextDecoder().decode(new Uint8Array(bytes));
    if (/^[\t\n\r -~]*$/u.test(decoded) && decoded.trim().length > 0) {
      return decoded;
    }
  } catch {
    // Fall through to the compact hex display.
  }
  return compactHex(hex);
}

function compactHex(hex: KeycatHex): string {
  if (hex.length <= 42) {
    return hex;
  }
  return `${hex.slice(0, 22)}...${hex.slice(-18)}`;
}

function compactJson(value: unknown): string {
  const json = JSON.stringify(value);
  return json.length > 180 ? `${json.slice(0, 180)}...` : json;
}

function formatEth(value: bigint): string {
  const whole = value / 1_000_000_000_000_000_000n;
  const fraction = value % 1_000_000_000_000_000_000n;
  if (fraction === 0n) {
    return whole.toString();
  }
  const fractionText = fraction.toString().padStart(18, "0").replace(/0+$/u, "");
  return `${whole}.${fractionText}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
