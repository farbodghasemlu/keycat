import type { KeycatAddress, KeycatHex } from "./types.js";

export type OneShotPayment =
  | { type: "sponsored"; data?: unknown }
  | { type: "token"; address: KeycatAddress; data?: unknown };

export type OneShotAuthorizationListEntry = {
  address: KeycatAddress;
  chainId: number | string;
  nonce: number | string;
  r: KeycatHex;
  s: KeycatHex;
  yParity: number | string;
};

export type OneShotDelegation7710 = {
  delegate: KeycatAddress;
  delegator: KeycatAddress;
  authority: KeycatHex;
  caveats: { enforcer: KeycatAddress; terms: KeycatHex; args: KeycatHex }[];
  salt: KeycatHex;
  signature: KeycatHex;
};

export type OneShotExecution7710 = {
  target: KeycatAddress;
  value: KeycatHex;
  data: KeycatHex;
};

export type OneShotDelegatedTransaction7710 = {
  permissionContext: OneShotDelegation7710[];
  executions: OneShotExecution7710[];
};

export type OneShotCapability = {
  feeCollector: KeycatAddress;
  targetAddress: KeycatAddress;
  tokens: {
    address: KeycatAddress;
    decimals: number | string;
    symbol?: string;
    name?: string;
  }[];
};

export type OneShotCapabilities = Record<string, OneShotCapability | undefined>;

export type OneShotEstimate7710Result = {
  success: boolean;
  paymentTokenAddress?: KeycatAddress;
  paymentChain?: number;
  gasUsed: Record<string, string>;
  requiredPaymentAmount?: string;
  context?: string;
  contextByChainId?: Record<string, string>;
  error?: string;
};

export type OneShotSend7710TransactionParams = {
  chainId: string;
  transactions: OneShotDelegatedTransaction7710[];
  authorizationList?: OneShotAuthorizationListEntry[];
  context?: string;
  taskId?: KeycatHex;
  destinationUrl?: string;
  memo?: string;
};

export type OneShotSendTransactionParams = {
  chainId: string;
  payment: OneShotPayment;
  to: KeycatAddress;
  data: KeycatHex;
  context?: string;
  authorizationList?: OneShotAuthorizationListEntry[];
  taskId?: KeycatHex;
};

export type OneShotStatus =
  | {
      id: KeycatHex;
      chainId: string;
      createdAt: number;
      status: 100;
      memo?: string;
    }
  | {
      id: KeycatHex;
      chainId: string;
      createdAt: number;
      status: 110;
      hash: KeycatHex;
      memo?: string;
    }
  | {
      id: KeycatHex;
      chainId: string;
      createdAt: number;
      status: 200;
      receipt: {
        blockHash: KeycatHex;
        blockNumber: KeycatHex;
        gasUsed: KeycatHex;
        transactionHash: KeycatHex;
      };
      memo?: string;
    }
  | {
      id: KeycatHex;
      chainId: string;
      createdAt: number;
      status: 400;
      message: string;
      data?: unknown;
      memo?: string;
    }
  | {
      id: KeycatHex;
      chainId: string;
      createdAt: number;
      status: 500;
      message?: string;
      data: KeycatHex;
      memo?: string;
    };

export class OneShotRelayerError extends Error {
  readonly code: number;
  readonly data?: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "OneShotRelayerError";
    this.code = code;
    this.data = data;
  }
}

export class OneShotRelayerClient {
  private nextId = 0;

  constructor(private readonly endpoint: string) {
    if (!endpoint) {
      throw new Error("NEXT_PUBLIC_ONESHOT_RELAYER_URL is required for 1Shot relay.");
    }
  }

  async getCapabilities(chainIds: string[]): Promise<OneShotCapabilities> {
    return this.request("relayer_getCapabilities", chainIds);
  }

  async estimate7710Transaction(
    params: OneShotSend7710TransactionParams
  ): Promise<OneShotEstimate7710Result> {
    return this.request("relayer_estimate7710Transaction", params);
  }

  async send7710Transaction(
    params: OneShotSend7710TransactionParams
  ): Promise<KeycatHex> {
    return this.request("relayer_send7710Transaction", params);
  }

  async sendTransaction(params: OneShotSendTransactionParams): Promise<KeycatHex> {
    return this.request("relayer_sendTransaction", params);
  }

  async getStatus(id: KeycatHex, logs = false): Promise<OneShotStatus> {
    return this.request("relayer_getStatus", { id, logs });
  }

  private async request<TResult>(method: string, param: unknown): Promise<TResult> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        {
          jsonrpc: "2.0",
          id: ++this.nextId,
          method,
          params: [param]
        },
        jsonReplacer
      )
    });

    const payload = (await response.json()) as {
      result?: TResult;
      error?: { code?: number; message?: string; data?: unknown };
    };

    if (!response.ok && !payload.error) {
      throw new OneShotRelayerError(
        response.status,
        `1Shot relayer HTTP ${response.status}.`
      );
    }
    if (payload.error) {
      throw new OneShotRelayerError(
        typeof payload.error.code === "number" ? payload.error.code : -32603,
        payload.error.message ?? "1Shot relayer request failed.",
        payload.error.data
      );
    }
    if (payload.result === undefined) {
      throw new OneShotRelayerError(-32603, "1Shot relayer returned no result.");
    }
    return payload.result;
  }
}

export function oneShotStatusState(
  status: OneShotStatus
): "pending" | "submitted" | "confirmed" | "rejected" | "reverted" {
  if (status.status === 100) {
    return "pending";
  }
  if (status.status === 110) {
    return "submitted";
  }
  if (status.status === 200) {
    return "confirmed";
  }
  if (status.status === 400) {
    return "rejected";
  }
  return "reverted";
}

export function isOneShotTerminalStatus(status: OneShotStatus): boolean {
  return status.status === 200 || status.status === 400 || status.status === 500;
}

function jsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? `0x${value.toString(16)}` : value;
}
