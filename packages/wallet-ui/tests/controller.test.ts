import { describe, expect, it, vi } from "vitest";
import type { Address, Hex, SignableMessage } from "viem";
import { sepolia } from "viem/chains";
import {
  ProviderRpcError,
  createKeycatController
} from "../src/controller.js";
import type {
  KeycatSigner,
  KeycatTransactionRequest,
  KeycatTypedDataPayload
} from "../src/signer.js";

const address = "0x0000000000000000000000000000000000000001" as Address;
const signerAddress = "0x0000000000000000000000000000000000000002" as Address;

function createSigner() {
  const calls: {
    personal?: SignableMessage;
    typed?: KeycatTypedDataPayload;
    transaction?: KeycatTransactionRequest;
    destroyed: boolean;
  } = { destroyed: false };
  const signer: KeycatSigner = {
    address,
    signerAddress,
    mode: "smart-account",
    implementation: "Hybrid",
    async signPersonalMessage(message) {
      calls.personal = message;
      return "0x1111" as Hex;
    },
    async signTypedData(payload) {
      calls.typed = payload;
      return "0x2222" as Hex;
    },
    async sendTransaction(transaction) {
      calls.transaction = transaction;
      return "0x3333333333333333333333333333333333333333333333333333333333333333";
    },
    destroy() {
      calls.destroyed = true;
    }
  };
  return { signer, calls };
}

describe("KeycatProviderController", () => {
  it("returns a stable snapshot until state changes", () => {
    const { signer } = createSigner();
    const controller = createKeycatController({ chain: sepolia, signer });
    const first = controller.getSnapshot();

    expect(controller.getSnapshot()).toBe(first);

    controller.lock("Test lock.");

    expect(controller.getSnapshot()).not.toBe(first);
    expect(controller.getSnapshot()).toBe(controller.getSnapshot());
  });

  it("routes connect requests through explicit approval", async () => {
    const { signer } = createSigner();
    const controller = createKeycatController({ chain: sepolia, signer });
    const origin = "https://swap.example";

    await expect(
      controller.request({ method: "eth_accounts" }, { origin })
    ).resolves.toEqual([]);

    const connect = controller.request(
      { method: "eth_requestAccounts" },
      { origin }
    );

    expect(controller.getSnapshot().pending?.kind).toBe("connect");
    controller.approvePending();

    await expect(connect).resolves.toEqual([address]);
    await expect(
      controller.request({ method: "eth_accounts" }, { origin })
    ).resolves.toEqual([address]);
  });

  it("confirms personal_sign before calling the signer", async () => {
    const { signer, calls } = createSigner();
    const controller = createKeycatController({ chain: sepolia, signer });

    const signature = controller.request(
      {
        method: "personal_sign",
        params: ["0x68656c6c6f", address]
      },
      { origin: "https://swap.example" }
    );

    expect(controller.getSnapshot().pending?.detail.description).toBe("hello");
    controller.approvePending();

    await expect(signature).resolves.toBe("0x1111");
    expect(calls.personal).toEqual({ raw: "0x68656c6c6f" });
  });

  it("proxies read-only RPC methods", async () => {
    const publicRpc = {
      request: vi.fn(async () => "0x7")
    };
    const controller = createKeycatController({
      chain: sepolia,
      publicRpc
    });

    await expect(
      controller.request({
        method: "eth_getBalance",
        params: [address, "latest"]
      })
    ).resolves.toBe("0x7");

    expect(publicRpc.request).toHaveBeenCalledWith({
      method: "eth_getBalance",
      params: [address, "latest"]
    });
  });

  it("rejects unimplemented signing methods", async () => {
    const controller = createKeycatController({ chain: sepolia });

    await expect(controller.request({ method: "eth_sign" })).rejects.toMatchObject({
      code: 4200
    } satisfies Partial<ProviderRpcError>);
  });

  it("routes transactions through the account address, not the owner signer", async () => {
    const { signer, calls } = createSigner();
    const controller = createKeycatController({ chain: sepolia, signer });

    const hash = controller.request(
      {
        method: "eth_sendTransaction",
        params: [{ from: address, to: address, value: "0x1" }]
      },
      { origin: "https://swap.example" }
    );

    expect(controller.getSnapshot().pending?.kind).toBe("eth_sendTransaction");
    controller.approvePending();

    await expect(hash).resolves.toBe(
      "0x3333333333333333333333333333333333333333333333333333333333333333"
    );
    expect(calls.transaction).toMatchObject({ to: address, value: 1n });

    const wrongFrom = controller.request(
      {
        method: "eth_sendTransaction",
        params: [{ from: signerAddress, to: address, value: "0x1" }]
      },
      { origin: "https://swap.example" }
    );
    controller.approvePending();

    await expect(wrongFrom).rejects.toMatchObject({
      code: 4100
    } satisfies Partial<ProviderRpcError>);
  });
});
