import {
  createPublicClient,
  encodeFunctionData,
  getAddress,
  http,
  isAddress,
  zeroAddress,
  type Chain
} from "viem";
import { OneShotRelayerClient } from "./oneshot.js";
import type { KeycatAddress, KeycatChainConfig, KeycatHex } from "./types.js";

export const DEFAULT_RECOVERY_TIMELOCK_SECONDS = 2 * 24 * 60 * 60;
export const ZK_EMAIL_RECOVERY_RELAYER_URL =
  "https://auth-base-sepolia-staging.prove.email/api";

export type RecoveryCommitment = {
  accountCode: KeycatHex;
  accountSalt: KeycatHex;
};

export type PendingRecovery = {
  newOwner: KeycatAddress;
  executeAfter: number;
  emailNullifier: KeycatHex;
  exists: boolean;
};

export const RECOVERY_CONTROLLER_READ_ABI = [
  {
    type: "function",
    name: "getPendingRecovery",
    inputs: [{ name: "account", type: "address" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "newOwner", type: "address" },
          { name: "executeAfter", type: "uint64" },
          { name: "emailNullifier", type: "bytes32" },
          { name: "exists", type: "bool" }
        ]
      }
    ],
    stateMutability: "view"
  }
] as const;

const RECOVERY_CONTROLLER_WRITE_ABI = [
  {
    type: "function",
    name: "handleRecovery",
    inputs: [
      {
        name: "emailAuthMsg",
        type: "tuple",
        components: [
          { name: "templateId", type: "uint256" },
          { name: "commandParams", type: "bytes[]" },
          { name: "skippedCommandPrefix", type: "uint256" },
          {
            name: "proof",
            type: "tuple",
            components: [
              { name: "domainName", type: "string" },
              { name: "publicKeyHash", type: "bytes32" },
              { name: "timestamp", type: "uint256" },
              { name: "maskedCommand", type: "string" },
              { name: "emailNullifier", type: "bytes32" },
              { name: "accountSalt", type: "bytes32" },
              { name: "isCodeExist", type: "bool" },
              { name: "proof", type: "bytes" }
            ]
          }
        ]
      },
      { name: "templateIdx", type: "uint256" }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "executeRecovery",
    inputs: [{ name: "account", type: "address" }],
    outputs: [],
    stateMutability: "nonpayable"
  }
] as const;

export function parseRecoveryControllerAddress(
  value?: string | null
): KeycatAddress | undefined {
  if (!value || value === zeroAddress || !isAddress(value)) {
    return undefined;
  }
  return getAddress(value) as KeycatAddress;
}

export async function createRecoveryCommitment({
  account,
  email
}: {
  account: KeycatAddress;
  email: string;
}): Promise<RecoveryCommitment> {
  const accountCode = randomHex32();
  const normalizedEmail = email.trim().toLowerCase();
  const input = new TextEncoder().encode(
    `keycat.zkemail.account-salt.v1:${account.toLowerCase()}:${normalizedEmail}:${accountCode}`
  );
  const digest = await globalThis.crypto.subtle.digest("SHA-256", input);
  return {
    accountCode,
    accountSalt: bytesToHex(new Uint8Array(digest))
  };
}

export async function readPendingRecovery({
  chain,
  rpcUrl,
  controllerAddress,
  account
}: {
  chain: KeycatChainConfig;
  rpcUrl?: string;
  controllerAddress: KeycatAddress;
  account: KeycatAddress;
}): Promise<PendingRecovery> {
  const client = createPublicClient({
    chain: chain as Chain,
    transport: http(rpcUrl)
  });
  const result = await client.readContract({
    address: controllerAddress,
    abi: RECOVERY_CONTROLLER_READ_ABI,
    functionName: "getPendingRecovery",
    args: [account]
  });
  return {
    newOwner: result.newOwner as KeycatAddress,
    executeAfter: Number(result.executeAfter),
    emailNullifier: result.emailNullifier as KeycatHex,
    exists: result.exists
  };
}

export async function submitMockRecoveryRequest({
  chain,
  rpcUrl,
  oneShotRelayerUrl,
  controllerAddress,
  account,
  newOwner,
  accountSalt
}: {
  chain: KeycatChainConfig;
  rpcUrl?: string;
  oneShotRelayerUrl?: string;
  controllerAddress: KeycatAddress;
  account: KeycatAddress;
  newOwner: KeycatAddress;
  accountSalt: KeycatHex;
}): Promise<KeycatHex> {
  const data = encodeFunctionData({
    abi: RECOVERY_CONTROLLER_WRITE_ABI,
    functionName: "handleRecovery",
    args: [
      {
        templateId: recoveryTemplateId(),
        commandParams: [
          encodeAddressParam(account),
          encodeAddressParam(newOwner)
        ],
        skippedCommandPrefix: 0n,
        proof: {
          domainName: "mock.keycat.local",
          publicKeyHash: `0x${"01".padStart(64, "0")}` as KeycatHex,
          timestamp: BigInt(Math.floor(Date.now() / 1000)),
          maskedCommand: "",
          emailNullifier: randomHex32(),
          accountSalt,
          isCodeExist: true,
          proof: "0x01"
        }
      },
      0n
    ]
  });
  return relayOrSendDustFallback({
    chain,
    rpcUrl,
    oneShotRelayerUrl,
    controllerAddress,
    data
  });
}

export async function submitRecoveryExecution({
  chain,
  rpcUrl,
  oneShotRelayerUrl,
  controllerAddress,
  account
}: {
  chain: KeycatChainConfig;
  rpcUrl?: string;
  oneShotRelayerUrl?: string;
  controllerAddress: KeycatAddress;
  account: KeycatAddress;
}): Promise<KeycatHex> {
  const data = encodeFunctionData({
    abi: RECOVERY_CONTROLLER_WRITE_ABI,
    functionName: "executeRecovery",
    args: [account]
  });
  return relayOrSendDustFallback({
    chain,
    rpcUrl,
    oneShotRelayerUrl,
    controllerAddress,
    data
  });
}

export function realRecoveryBlockedMessage(): string {
  return [
    "ZK Email's documented relayer requires the recovery email address in its API to compute accountSalt.",
    "Keycat does not send plaintext recovery email to APIs.",
    "Use DEMO_MOCK_RECOVERY or a relayer flow that derives accountSalt only from the user's email submission."
  ].join(" ");
}

async function relayOrSendDustFallback({
  chain,
  oneShotRelayerUrl,
  controllerAddress,
  data
}: {
  chain: KeycatChainConfig;
  rpcUrl?: string;
  oneShotRelayerUrl?: string;
  controllerAddress: KeycatAddress;
  data: KeycatHex;
}): Promise<KeycatHex> {
  if (!oneShotRelayerUrl) {
    throw new Error(
      "1Shot relayer URL is not configured. Fund any address with dust and submit this controller calldata manually."
    );
  }
  const relayer = new OneShotRelayerClient(oneShotRelayerUrl);
  return relayer.sendTransaction({
    chainId: String(chain.id),
    payment: { type: "sponsored" },
    to: controllerAddress,
    data
  });
}

function recoveryTemplateId(): bigint {
  return BigInt(
    "41597252099594059824363833791590872545117890762070757419930713588231239964259"
  );
}

function encodeAddressParam(address: KeycatAddress): KeycatHex {
  return `0x${address.toLowerCase().replace(/^0x/u, "").padStart(64, "0")}`;
}

function randomHex32(): KeycatHex {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

function bytesToHex(bytes: Uint8Array): KeycatHex {
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
