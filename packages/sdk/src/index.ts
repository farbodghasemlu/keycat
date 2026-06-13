export type KeycatVaultInitOptions = {
  chainId?: number;
  widgetUrl?: string;
};

export type Eip1193RequestArguments = {
  method: string;
  params?: unknown;
};

export type Eip1193Provider = {
  request(args: Eip1193RequestArguments): Promise<unknown>;
  on(event: string, listener: (...args: unknown[]) => void): void;
  removeListener(event: string, listener: (...args: unknown[]) => void): void;
};

export type BridgeMessageEvent = {
  origin: string;
  data: unknown;
};

export type BridgeEventTarget = {
  addEventListener(
    event: "message",
    listener: (event: BridgeMessageEvent) => void
  ): void;
  removeEventListener(
    event: "message",
    listener: (event: BridgeMessageEvent) => void
  ): void;
};

export type BridgePostTarget = {
  postMessage(message: unknown, targetOrigin: string): void;
};

export type KeycatBridgeProvider = Eip1193Provider & {
  destroy(): void;
  handleMessage(event: BridgeMessageEvent): void;
};

export type CreateBridgeProviderOptions = {
  postTarget: BridgePostTarget;
  listenTarget: BridgeEventTarget;
  widgetOrigin: string;
  requestOrigin: string;
  idFactory?: () => string;
};

export const KEYCAT_SDK_SOURCE = "keycat-sdk";
export const KEYCAT_WIDGET_SOURCE = "keycat-widget";

export class KeycatProviderError extends Error {
  readonly code: number;
  readonly data?: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "KeycatProviderError";
    this.code = code;
    this.data = data;
  }
}

export function createBridgeProvider({
  postTarget,
  listenTarget,
  widgetOrigin,
  requestOrigin,
  idFactory = createRequestId
}: CreateBridgeProviderOptions): KeycatBridgeProvider {
  const pending = new Map<
    string,
    { resolve(value: unknown): void; reject(error: KeycatProviderError): void }
  >();
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  function emit(event: string, params: unknown[]) {
    for (const listener of listeners.get(event) ?? []) {
      listener(...params);
    }
  }

  function handleMessage(event: BridgeMessageEvent) {
    if (event.origin !== widgetOrigin || !isRecord(event.data)) {
      return;
    }
    if (event.data.source !== KEYCAT_WIDGET_SOURCE) {
      return;
    }

    if (typeof event.data.event === "string") {
      emit(event.data.event, Array.isArray(event.data.params) ? event.data.params : []);
      return;
    }

    if (typeof event.data.id !== "string") {
      return;
    }
    const deferred = pending.get(event.data.id);
    if (!deferred) {
      return;
    }
    pending.delete(event.data.id);

    if (isRecord(event.data.error)) {
      deferred.reject(
        new KeycatProviderError(
          typeof event.data.error.code === "number" ? event.data.error.code : -32603,
          typeof event.data.error.message === "string"
            ? event.data.error.message
            : "Keycat request failed.",
          event.data.error.data
        )
      );
      return;
    }
    deferred.resolve(event.data.result);
  }

  listenTarget.addEventListener("message", handleMessage);

  return {
    request(args) {
      if (!args || typeof args.method !== "string") {
        return Promise.reject(
          new KeycatProviderError(-32602, "Provider request requires a method.")
        );
      }
      const id = idFactory();
      const promise = new Promise<unknown>((resolve, reject) => {
        pending.set(id, { resolve, reject });
      });
      postTarget.postMessage(
        {
          source: KEYCAT_SDK_SOURCE,
          id,
          origin: requestOrigin,
          method: args.method,
          params: args.params
        },
        widgetOrigin
      );
      return promise;
    },
    on(event, listener) {
      const eventListeners = listeners.get(event) ?? new Set();
      eventListeners.add(listener);
      listeners.set(event, eventListeners);
    },
    removeListener(event, listener) {
      listeners.get(event)?.delete(listener);
    },
    destroy() {
      listenTarget.removeEventListener("message", handleMessage);
      for (const deferred of pending.values()) {
        deferred.reject(new KeycatProviderError(4900, "Keycat bridge closed."));
      }
      pending.clear();
      listeners.clear();
    },
    handleMessage
  };
}

export function isInteractiveMethod(method: string): boolean {
  return (
    method === "eth_requestAccounts" ||
    method === "personal_sign" ||
    method === "eth_signTypedData_v4" ||
    method === "eth_sendTransaction"
  );
}

export function normalizeWidgetUrl(widgetUrl: string, chainId?: number): URL {
  const url = new URL(widgetUrl, "https://keycat.net");
  if (chainId !== undefined) {
    url.searchParams.set("chainId", String(chainId));
  }
  return url;
}

function createRequestId(): string {
  const random = globalThis.crypto?.getRandomValues
    ? globalThis.crypto.getRandomValues(new Uint32Array(2))
    : undefined;
  if (random) {
    return `${Date.now().toString(36)}-${random[0]?.toString(36)}${random[1]?.toString(36)}`;
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
