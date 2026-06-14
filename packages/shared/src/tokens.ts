import type { Address } from "viem";
import { base, baseSepolia, sepolia } from "viem/chains";

export type KeycatTokenListToken = {
  chainId: number;
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string;
};

export type KeycatTokenList = {
  name: string;
  version: {
    major: number;
    minor: number;
    patch: number;
  };
  tokens: KeycatTokenListToken[];
};

export const KEYCAT_TOKEN_LIST = {
  name: "Keycat curated tokens",
  version: {
    major: 0,
    minor: 1,
    patch: 0
  },
  tokens: [
    {
      chainId: sepolia.id,
      address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
      symbol: "USDC",
      name: "USD Coin",
      decimals: 6
    },
    {
      chainId: baseSepolia.id,
      address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      symbol: "USDC",
      name: "USD Coin",
      decimals: 6
    },
    {
      chainId: base.id,
      address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      symbol: "USDC",
      name: "USD Coin",
      decimals: 6
    }
  ]
} as const satisfies KeycatTokenList;
