import {
  generateAccountCode,
  generateAccountSalt,
  init as initZkEmailRelayerUtils
} from "@zk-email/relayer-utils";
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

export type RecoveryConfig = {
  emailGuardianCommitment: KeycatHex;
  timelockSeconds: number;
  configured: boolean;
  permissionContext: KeycatHex;
};

export const RECOVERY_CONTROLLER_READ_ABI = [
  {
    type: "function",
    name: "getRecoveryConfig",
    inputs: [{ name: "account", type: "address" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "emailGuardianCommitment", type: "bytes32" },
          { name: "timelockSeconds", type: "uint64" },
          { name: "configured", type: "bool" },
          { name: "permissionContext", type: "bytes" }
        ]
      }
    ],
    stateMutability: "view"
  },
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

let zkEmailRelayerUtilsReady: Promise<void> | undefined;

export function parseRecoveryControllerAddress(
  value?: string | null
): KeycatAddress | undefined {
  if (!value || value === zeroAddress || !isAddress(value)) {
    return undefined;
  }
  return getAddress(value) as KeycatAddress;
}

export async function createRecoveryCommitment({
  email
}: {
  account: KeycatAddress;
  email: string;
}): Promise<RecoveryCommitment> {
  await ensureZkEmailRelayerUtils();
  const accountCode = normalizeRecoveryBytes32(await generateAccountCode(), "accountCode");
  const accountSalt = await deriveRecoveryAccountSalt({ email, accountCode });
  return {
    accountCode,
    accountSalt
  };
}

export async function deriveRecoveryAccountSalt({
  email,
  accountCode
}: {
  email: string;
  accountCode: KeycatHex;
}): Promise<KeycatHex> {
  await ensureZkEmailRelayerUtils();
  const normalizedEmail = email.trim().toLowerCase();
  return normalizeRecoveryBytes32(
    await generateAccountSalt(normalizedEmail, accountCode),
    "accountSalt"
  );
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

export async function readRecoveryConfig({
  chain,
  rpcUrl,
  controllerAddress,
  account
}: {
  chain: KeycatChainConfig;
  rpcUrl?: string;
  controllerAddress: KeycatAddress;
  account: KeycatAddress;
}): Promise<RecoveryConfig> {
  const client = createPublicClient({
    chain: chain as Chain,
    transport: http(rpcUrl)
  });
  const result = await client.readContract({
    address: controllerAddress,
    abi: RECOVERY_CONTROLLER_READ_ABI,
    functionName: "getRecoveryConfig",
    args: [account]
  });
  return {
    emailGuardianCommitment: result.emailGuardianCommitment as KeycatHex,
    timelockSeconds: Number(result.timelockSeconds),
    configured: result.configured,
    permissionContext: result.permissionContext as KeycatHex
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
    "Real recovery is unavailable until the ZK Email relayer proof flow is wired.",
    "Keycat derives accountSalt locally and never sends your email to an API.",
    "Your email never appears on-chain in plaintext; the ZK Email relayer sees it only when you send recovery mail and cannot forge a proof."
  ].join(" ");
}

async function ensureZkEmailRelayerUtils(): Promise<void> {
  zkEmailRelayerUtilsReady ??= initZkEmailRelayerUtils();
  await zkEmailRelayerUtilsReady;
}

function normalizeRecoveryBytes32(value: unknown, label: string): KeycatHex {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/u.test(value)) {
    throw new Error(`ZK Email returned an invalid ${label}.`);
  }
  return value.toLowerCase() as KeycatHex;
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
