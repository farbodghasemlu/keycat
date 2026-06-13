import type { UnlockedKeystore } from "@keycat/keystore";
import {
  createWalletClient,
  http,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type {
  KeycatAddress,
  KeycatChainConfig,
  KeycatHex,
  KeycatSignableMessage,
  KeycatSigner,
  KeycatTransactionRequest,
  KeycatTypedDataPayload
} from "./types.js";

export class LocalEoaKeycatSigner implements KeycatSigner {
  readonly address: KeycatAddress;

  constructor(
    private readonly unlocked: UnlockedKeystore,
    private readonly chain: KeycatChainConfig,
    private readonly rpcUrl?: string
  ) {
    this.address = privateKeyToAccount(this.unlocked.privateKey).address as KeycatAddress;
  }

  async signPersonalMessage(message: KeycatSignableMessage): Promise<KeycatHex> {
    const account = privateKeyToAccount(this.unlocked.privateKey);
    return account.signMessage({ message }) as Promise<KeycatHex>;
  }

  async signTypedData(payload: KeycatTypedDataPayload): Promise<KeycatHex> {
    const account = privateKeyToAccount(this.unlocked.privateKey);
    return account.signTypedData(payload as never) as Promise<KeycatHex>;
  }

  async sendTransaction(transaction: KeycatTransactionRequest): Promise<KeycatHex> {
    const account = privateKeyToAccount(this.unlocked.privateKey);
    const walletClient = createWalletClient({
      account,
      chain: this.chain as Chain,
      transport: http(this.rpcUrl)
    });
    return walletClient.sendTransaction(transaction as never) as Promise<KeycatHex>;
  }

  destroy(): void {
    this.unlocked.zeroize();
  }
}

export function createLocalEoaSigner(
  unlocked: UnlockedKeystore,
  chain: KeycatChainConfig,
  rpcUrl?: string
): KeycatSigner {
  return new LocalEoaKeycatSigner(unlocked, chain, rpcUrl);
}
