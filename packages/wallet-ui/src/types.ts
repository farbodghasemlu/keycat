export type KeycatHex = `0x${string}`;
export type KeycatAddress = `0x${string}`;

export type KeycatSignableMessage = string | { raw: KeycatHex };

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

export type KeycatSigner = {
  readonly address: KeycatAddress;
  signPersonalMessage(message: KeycatSignableMessage): Promise<KeycatHex>;
  signTypedData(payload: KeycatTypedDataPayload): Promise<KeycatHex>;
  sendTransaction(transaction: KeycatTransactionRequest): Promise<KeycatHex>;
  destroy(): void;
};

export type PublicRpcProxy = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
};
