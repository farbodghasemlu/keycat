import type { Chain } from "viem";
import { base, baseSepolia, sepolia } from "viem/chains";

export type KeycatChainName = "sepolia" | "base-sepolia" | "base";

export const DEFAULT_KEYCAT_CHAIN_NAME: KeycatChainName = "sepolia";
export const DEFAULT_KEYCAT_CHAIN_ID = sepolia.id;
export const KEYCAT_RECOVERY_CHAIN_NAME: KeycatChainName = "base-sepolia";
export const KEYCAT_RECOVERY_CHAIN_ID = baseSepolia.id;

export const KEYCAT_CHAINS = {
  sepolia,
  "base-sepolia": baseSepolia,
  base
} as const satisfies Record<KeycatChainName, Chain>;

export const KEYCAT_CHAIN_OPTIONS = Object.values(KEYCAT_CHAINS);

export type KeycatChain = (typeof KEYCAT_CHAIN_OPTIONS)[number];

export function getKeycatChain(selection?: KeycatChainName | number | null): Chain {
  if (selection === undefined || selection === null) {
    return KEYCAT_CHAINS[DEFAULT_KEYCAT_CHAIN_NAME];
  }

  if (typeof selection === "number") {
    const chain = KEYCAT_CHAIN_OPTIONS.find((candidate) => candidate.id === selection);
    if (!chain) {
      throw new Error(`Unsupported Keycat chain id: ${selection}`);
    }
    return chain;
  }

  const chain = KEYCAT_CHAINS[selection];
  if (!chain) {
    throw new Error(`Unsupported Keycat chain: ${selection}`);
  }
  return chain;
}

export function getKeycatChainFromEnvironment(value?: string | null): Chain {
  if (!value) {
    return getKeycatChain(DEFAULT_KEYCAT_CHAIN_NAME);
  }
  const numeric = Number(value);
  if (Number.isInteger(numeric)) {
    return getKeycatChain(numeric);
  }
  return getKeycatChain(value as KeycatChainName);
}

export function chainIdToHex(chainId: number): `0x${string}` {
  return `0x${chainId.toString(16)}`;
}
