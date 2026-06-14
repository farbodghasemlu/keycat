export type KeycatHex = `0x${string}`;
export type KeycatAddress = `0x${string}`;

export type KeycatSignableMessage = string | { raw: KeycatHex };
export type KeycatSignerMode = "plain-eoa" | "smart-account" | "eip7702";
export type KeycatSmartAccountImplementation = "Hybrid" | "Stateless7702";

export type KeycatChainConfig = {
  id: number;
  name: string;
  nativeCurrency?: {
    name: string;
    symbol: string;
    decimals: number;
  };
  rpcUrls?: Record<string, unknown>;
};

export type KeycatTypedDataPayload = {
  domain?: Record<string, unknown>;
  types: Record<string, readonly { name: string; type: string }[]>;
  primaryType: string;
  message: Record<string, unknown>;
};

export type KeycatTransactionRequest = {
  from?: KeycatAddress;
  to?: KeycatAddress;
  value?: bigint;
  data?: KeycatHex;
  gas?: bigint;
  gasPrice?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  nonce?: number;
  chainId?: number;
};

export type KeycatGaslessStatus = {
  enabled: boolean;
  state: "idle" | "pending" | "submitted" | "confirmed" | "rejected" | "reverted";
  taskId?: KeycatHex;
  transactionHash?: KeycatHex;
  message?: string;
  delegateAddress?: KeycatAddress;
  sessionKeyAddress?: KeycatAddress;
  expiresAt?: number;
};

export type KeycatAiReviewSeverity = "low" | "medium" | "high";

export type KeycatAiReviewRisk = {
  label: string;
  severity: KeycatAiReviewSeverity;
  source: "local" | "venice";
};

export type KeycatAiReviewResult = {
  status: "local" | "loading" | "ready" | "unavailable";
  summary: string;
  risks: KeycatAiReviewRisk[];
  severity: KeycatAiReviewSeverity;
  pricePaid?: string;
  notice?: string;
};

export type KeycatAiReviewDelegationScope = {
  endpoint: string;
  chainId: number;
  network: `eip155:${number}`;
  stablecoinAddress: KeycatAddress;
  payeeAddress: KeycatAddress;
  dailyUsdLimit: "0.25";
  dailyLimitAtomic: string;
  periodSeconds: 86400;
  expiresAt: number;
};

export type KeycatAiReviewStatus = {
  enabled: boolean;
  state: "disabled" | "probing" | "ready";
  dailyUsdLimit?: "0.25";
  payeeAddress?: KeycatAddress;
  stablecoinAddress?: KeycatAddress;
  payerAddress?: KeycatAddress;
  sessionKeyAddress?: KeycatAddress;
  chainId?: number;
  expiresAt?: number;
  message?: string;
};

export type KeycatAiReviewRequest =
  | {
      kind: "transaction";
      origin: string;
      chainId: number;
      transaction: KeycatTransactionRequest;
      local: KeycatAiReviewResult;
    }
  | {
      kind: "typed-data";
      origin: string;
      chainId: number;
      typedData: KeycatTypedDataPayload;
      local: KeycatAiReviewResult;
    };

export type KeycatAiReviewOptions = {
  endpoint?: string;
  fetch?: typeof fetch;
  scope?: KeycatAiReviewDelegationScope;
};

export type KeycatSignerSnapshot = {
  address: KeycatAddress;
  signerAddress: KeycatAddress;
  mode: KeycatSignerMode;
  implementation?: KeycatSmartAccountImplementation;
  gasless?: KeycatGaslessStatus;
  aiReview?: KeycatAiReviewStatus;
};

export type KeycatSigner = {
  readonly address: KeycatAddress;
  readonly signerAddress: KeycatAddress;
  readonly mode: KeycatSignerMode;
  readonly implementation?: KeycatSmartAccountImplementation;
  signPersonalMessage(message: KeycatSignableMessage): Promise<KeycatHex>;
  signTypedData(payload: KeycatTypedDataPayload): Promise<KeycatHex>;
  sendTransaction(transaction: KeycatTransactionRequest): Promise<KeycatHex>;
  setGaslessMode?(enabled: boolean): Promise<void>;
  setAiReviewMode?(enabled: boolean, options?: KeycatAiReviewOptions): Promise<void>;
  reviewWithAi?(request: KeycatAiReviewRequest): Promise<KeycatAiReviewResult>;
  getSnapshot?(): KeycatSignerSnapshot;
  subscribe?(listener: () => void): () => void;
  destroy(): void;
};

export type PublicRpcProxy = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
};
