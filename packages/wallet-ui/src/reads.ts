import {
  createPublicClient,
  http,
  parseAbi,
  type Chain
} from "viem";
import { useEffect, useMemo, useState } from "react";
import {
  readPendingRecovery,
  readRecoveryConfig,
  type PendingRecovery,
  type RecoveryConfig
} from "./recovery.js";
import type {
  KeycatActivityLogEntry,
  KeycatAddress,
  KeycatChainConfig,
  KeycatSignerSnapshot
} from "./types.js";
import type { KeycatControllerSnapshot } from "./controller.js";

const ERC20_BALANCE_ABI = parseAbi([
  "function balanceOf(address account) view returns (uint256)"
]);

export type KeycatReadHookResult<T> = {
  data?: T;
  loading: boolean;
  error?: Error;
  refresh(): void;
};

export type KeycatBalanceToken = {
  chainId: number;
  address: KeycatAddress;
  symbol: string;
  decimals: number;
  name?: string;
};

export type KeycatNativeBalance = {
  account: KeycatAddress;
  balance: bigint;
  symbol?: string;
  decimals?: number;
};

export type KeycatErc20Balance = KeycatBalanceToken & {
  account: KeycatAddress;
  balance: bigint;
};

export type KeycatActiveDelegation = {
  id: string;
  kind: "gasless" | "ai-review";
  state: string;
  delegateAddress?: KeycatAddress;
  sessionKeyAddress?: KeycatAddress;
  payerAddress?: KeycatAddress;
  payeeAddress?: KeycatAddress;
  stablecoinAddress?: KeycatAddress;
  chainId?: number;
  dailyUsdLimit?: string;
  expiresAt?: number;
};

export type KeycatRecoveryReadStatus = {
  controllerAddress: KeycatAddress;
  account: KeycatAddress;
  config: RecoveryConfig;
  pending: PendingRecovery;
  canCancel: boolean;
};

export async function readNativeBalance({
  chain,
  rpcUrl,
  account
}: {
  chain: KeycatChainConfig;
  rpcUrl?: string;
  account: KeycatAddress;
}): Promise<KeycatNativeBalance> {
  const client = createPublicClient({
    chain: chain as Chain,
    transport: http(rpcUrl)
  });
  const balance = await client.getBalance({ address: account });
  return {
    account,
    balance,
    symbol: chain.nativeCurrency?.symbol,
    decimals: chain.nativeCurrency?.decimals
  };
}

export async function readErc20Balances({
  chain,
  rpcUrl,
  account,
  tokens
}: {
  chain: KeycatChainConfig;
  rpcUrl?: string;
  account: KeycatAddress;
  tokens: KeycatBalanceToken[];
}): Promise<KeycatErc20Balance[]> {
  const client = createPublicClient({
    chain: chain as Chain,
    transport: http(rpcUrl)
  });
  const chainTokens = tokens.filter((token) => token.chainId === chain.id);
  return Promise.all(
    chainTokens.map(async (token) => ({
      ...token,
      account,
      balance: await client.readContract({
        address: token.address,
        abi: ERC20_BALANCE_ABI,
        functionName: "balanceOf",
        args: [account]
      })
    }))
  );
}

export async function readRecoveryStatus({
  chain,
  rpcUrl,
  controllerAddress,
  account,
  now = Math.floor(Date.now() / 1000)
}: {
  chain: KeycatChainConfig;
  rpcUrl?: string;
  controllerAddress: KeycatAddress;
  account: KeycatAddress;
  now?: number;
}): Promise<KeycatRecoveryReadStatus> {
  const [config, pending] = await Promise.all([
    readRecoveryConfig({ chain, rpcUrl, controllerAddress, account }),
    readPendingRecovery({ chain, rpcUrl, controllerAddress, account })
  ]);
  return {
    controllerAddress,
    account,
    config,
    pending,
    canCancel: pending.exists && now < pending.executeAfter
  };
}

export function readActiveDelegations(
  snapshot?: Pick<KeycatControllerSnapshot, "signer">
): KeycatActiveDelegation[] {
  const signer = snapshot?.signer;
  if (!signer) {
    return [];
  }
  return activeDelegationsFromSigner(signer);
}

export function readActivityLog(
  snapshot?: Pick<KeycatControllerSnapshot, "activity">
): KeycatActivityLogEntry[] {
  return snapshot?.activity ? [...snapshot.activity] : [];
}

export function useNativeBalance({
  chain,
  rpcUrl,
  account
}: {
  chain: KeycatChainConfig;
  rpcUrl?: string;
  account?: KeycatAddress;
}): KeycatReadHookResult<KeycatNativeBalance> {
  return useAsyncRead(
    () => account ? readNativeBalance({ chain, rpcUrl, account }) : Promise.resolve(undefined),
    [chain, rpcUrl, account]
  );
}

export function useErc20Balances({
  chain,
  rpcUrl,
  account,
  tokens
}: {
  chain: KeycatChainConfig;
  rpcUrl?: string;
  account?: KeycatAddress;
  tokens: KeycatBalanceToken[];
}): KeycatReadHookResult<KeycatErc20Balance[]> {
  return useAsyncRead(
    () =>
      account
        ? readErc20Balances({ chain, rpcUrl, account, tokens })
        : Promise.resolve(undefined),
    [chain, rpcUrl, account, tokens]
  );
}

export function useRecoveryStatus({
  chain,
  rpcUrl,
  controllerAddress,
  account
}: {
  chain: KeycatChainConfig;
  rpcUrl?: string;
  controllerAddress?: KeycatAddress;
  account?: KeycatAddress;
}): KeycatReadHookResult<KeycatRecoveryReadStatus> {
  return useAsyncRead(
    () =>
      controllerAddress && account
        ? readRecoveryStatus({ chain, rpcUrl, controllerAddress, account })
        : Promise.resolve(undefined),
    [chain, rpcUrl, controllerAddress, account]
  );
}

export function useActiveDelegations(
  snapshot?: Pick<KeycatControllerSnapshot, "signer">
): KeycatActiveDelegation[] {
  return useMemo(() => readActiveDelegations(snapshot), [snapshot]);
}

export function useKeycatActivityLog(
  snapshot?: Pick<KeycatControllerSnapshot, "activity">
): KeycatActivityLogEntry[] {
  return useMemo(() => readActivityLog(snapshot), [snapshot]);
}

function useAsyncRead<T>(
  read: () => Promise<T | undefined>,
  dependencies: readonly unknown[]
): KeycatReadHookResult<T> {
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<{
    data?: T;
    loading: boolean;
    error?: Error;
  }>({ loading: false });

  useEffect(() => {
    let cancelled = false;
    setState((current) => ({ ...current, loading: true, error: undefined }));
    void read()
      .then((data) => {
        if (!cancelled) {
          setState({ ...(data !== undefined ? { data } : {}), loading: false });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            loading: false,
            error: error instanceof Error ? error : new Error("Read failed.")
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [...dependencies, version]);

  return {
    ...state,
    refresh: () => setVersion((current) => current + 1)
  };
}

function activeDelegationsFromSigner(
  signer: KeycatSignerSnapshot
): KeycatActiveDelegation[] {
  const delegations: KeycatActiveDelegation[] = [];
  if (signer.gasless?.enabled) {
    delegations.push({
      id: "gasless",
      kind: "gasless",
      state: signer.gasless.state,
      delegateAddress: signer.gasless.delegateAddress,
      sessionKeyAddress: signer.gasless.sessionKeyAddress,
      expiresAt: signer.gasless.expiresAt
    });
  }
  if (signer.aiReview?.enabled) {
    delegations.push({
      id: "ai-review",
      kind: "ai-review",
      state: signer.aiReview.state,
      sessionKeyAddress: signer.aiReview.sessionKeyAddress,
      payerAddress: signer.aiReview.payerAddress,
      payeeAddress: signer.aiReview.payeeAddress,
      stablecoinAddress: signer.aiReview.stablecoinAddress,
      chainId: signer.aiReview.chainId,
      dailyUsdLimit: signer.aiReview.dailyUsdLimit,
      expiresAt: signer.aiReview.expiresAt
    });
  }
  return delegations;
}
