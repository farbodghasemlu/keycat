import { describe, expect, it } from "vitest";
import {
  KEYCAT_WIDGET_SOURCE,
  createBridgeProvider,
  type BridgeMessageEvent
} from "../src/index.js";

class FakeMessageTarget {
  readonly messages: { message: unknown; targetOrigin: string }[] = [];
  private listeners = new Set<(event: BridgeMessageEvent) => void>();

  postMessage(message: unknown, targetOrigin: string): void {
    this.messages.push({ message, targetOrigin });
  }

  addEventListener(
    _event: "message",
    listener: (event: BridgeMessageEvent) => void
  ): void {
    this.listeners.add(listener);
  }

  removeEventListener(
    _event: "message",
    listener: (event: BridgeMessageEvent) => void
  ): void {
    this.listeners.delete(listener);
  }

  dispatch(event: BridgeMessageEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

describe("createBridgeProvider", () => {
  it("ignores responses from non-widget origins", async () => {
    const target = new FakeMessageTarget();
    const provider = createBridgeProvider({
      postTarget: target,
      listenTarget: target,
      widgetOrigin: "https://keycat.net",
      requestOrigin: "https://swap.example",
      idFactory: () => "request-1"
    });

    let settled = false;
    const request = provider
      .request({ method: "eth_chainId" })
      .then((value) => {
        settled = true;
        return value;
      });

    target.dispatch({
      origin: "https://attacker.example",
      data: {
        source: KEYCAT_WIDGET_SOURCE,
        id: "request-1",
        result: "0x1"
      }
    });
    expect(settled).toBe(false);

    target.dispatch({
      origin: "https://keycat.net",
      data: {
        source: KEYCAT_WIDGET_SOURCE,
        id: "request-1",
        result: "0xaa36a7"
      }
    });

    await expect(request).resolves.toBe("0xaa36a7");
    expect(target.messages[0]?.targetOrigin).toBe("https://keycat.net");
  });

  it("matches responses by request id", async () => {
    const target = new FakeMessageTarget();
    const provider = createBridgeProvider({
      postTarget: target,
      listenTarget: target,
      widgetOrigin: "https://keycat.net",
      requestOrigin: "https://swap.example",
      idFactory: () => "request-2"
    });

    let settled = false;
    const request = provider
      .request({ method: "eth_accounts" })
      .then((value) => {
        settled = true;
        return value;
      });

    target.dispatch({
      origin: "https://keycat.net",
      data: {
        source: KEYCAT_WIDGET_SOURCE,
        id: "other-request",
        result: ["0x0000000000000000000000000000000000000000"]
      }
    });
    expect(settled).toBe(false);

    target.dispatch({
      origin: "https://keycat.net",
      data: {
        source: KEYCAT_WIDGET_SOURCE,
        id: "request-2",
        result: []
      }
    });

    await expect(request).resolves.toEqual([]);
  });
});
