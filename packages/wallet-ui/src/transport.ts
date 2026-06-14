export const KEYCAT_SDK_SOURCE = "keycat-sdk";
export const KEYCAT_WIDGET_SOURCE = "keycat-widget";

export type KeycatTransportRequest = {
  id: string;
  origin: string;
  method: string;
  params?: unknown;
};

export type KeycatTransportResponse =
  | { result: unknown }
  | { error: { code: number; message: string; data?: unknown } };

export type KeycatWalletTransport = {
  subscribe(
    handler: (request: KeycatTransportRequest) => void | Promise<void>
  ): () => void;
  respond(request: KeycatTransportRequest, response: KeycatTransportResponse): void;
  emit(event: "accountsChanged" | "disconnect", params: unknown[]): void;
  setVisible?(visible: boolean): void;
};

export type KeycatWidgetConfig = {
  allowedOrigin: string;
  chainId?: number;
};

export function readKeycatWidgetConfig(search = globalThis.location?.search): KeycatWidgetConfig | null {
  const params = new URLSearchParams(search);
  const rawOrigin = params.get("keycatOrigin");
  if (!rawOrigin) {
    return null;
  }

  let allowedOrigin: string;
  try {
    allowedOrigin = new URL(rawOrigin).origin;
  } catch {
    return null;
  }
  if (allowedOrigin === "null") {
    return null;
  }

  const rawChainId = params.get("chainId");
  const chainId = rawChainId ? Number(rawChainId) : undefined;
  return {
    allowedOrigin,
    ...(Number.isInteger(chainId) ? { chainId } : {})
  };
}

export function createKeycatWindowTransport({
  allowedOrigin,
  parentWindow,
  currentWindow
}: {
  allowedOrigin: string;
  parentWindow?: Window;
  currentWindow?: Window;
}): KeycatWalletTransport {
  const resolvedParentWindow = parentWindow ?? window.parent;
  const resolvedCurrentWindow = currentWindow ?? window;
  return {
    subscribe(handler) {
      const listener = (event: MessageEvent) => {
        if (event.origin !== allowedOrigin || event.source !== resolvedParentWindow) {
          return;
        }
        const data = event.data;
        if (!isRecord(data) || data.source !== KEYCAT_SDK_SOURCE) {
          return;
        }
        if (typeof data.id !== "string" || typeof data.method !== "string") {
          return;
        }
        void handler({
          id: data.id,
          origin: event.origin,
          method: data.method,
          params: data.params
        });
      };
      resolvedCurrentWindow.addEventListener("message", listener);
      return () => resolvedCurrentWindow.removeEventListener("message", listener);
    },
    respond(request, response) {
      resolvedParentWindow.postMessage(
        {
          source: KEYCAT_WIDGET_SOURCE,
          id: request.id,
          ...response
        },
        allowedOrigin
      );
    },
    emit(event, params) {
      resolvedParentWindow.postMessage(
        {
          source: KEYCAT_WIDGET_SOURCE,
          event,
          params
        },
        allowedOrigin
      );
    },
    setVisible(visible) {
      resolvedParentWindow.postMessage(
        {
          source: KEYCAT_WIDGET_SOURCE,
          ui: visible ? "visible" : "hidden"
        },
        allowedOrigin
      );
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
