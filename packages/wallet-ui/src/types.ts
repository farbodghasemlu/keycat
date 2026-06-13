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

export type KeycatSignerSnapshot = {
  address: KeycatAddress;
  signerAddress: KeycatAddress;
  mode: KeycatSignerMode;
  implementation?: KeycatSmartAccountImplementation;
  gasless?: KeycatGaslessStatus;
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
  getSnapshot?(): KeycatSignerSnapshot;
  subscribe?(listener: () => void): () => void;
  destroy(): void;
};

export type PublicRpcProxy = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
};
