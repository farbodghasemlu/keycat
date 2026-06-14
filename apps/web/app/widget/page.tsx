"use client";

import {
  KeycatWallet,
  type KeycatTransportRequest,
  type KeycatTransportResponse,
  type KeycatWalletTransport
} from "@keycat/wallet-ui";
import { useEffect, useMemo, useState } from "react";

const SDK_SOURCE = "keycat-sdk";
const WIDGET_SOURCE = "keycat-widget";

type WidgetConfig = {
  allowedOrigin: string;
  chainId?: number;
};

export default function WidgetPage() {
  const [config, setConfig] = useState<WidgetConfig | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setConfig(readWidgetConfig());
  }, []);

  const transport = useMemo(
    () => (config ? createWindowTransport(config.allowedOrigin) : undefined),
    [config]
  );

  if (!mounted || !config || !transport) {
    return null;
  }

  return (
    <KeycatWallet
      mode="embedded"
      chainId={config.chainId}
      bundlerUrl={process.env.NEXT_PUBLIC_BUNDLER_URL}
      oneShotRelayerUrl={process.env.NEXT_PUBLIC_ONESHOT_RELAYER_URL}
      oneShotWebhookUrl={process.env.NEXT_PUBLIC_ONESHOT_WEBHOOK_URL}
      veniceX402Endpoint={process.env.NEXT_PUBLIC_VENICE_X402_ENDPOINT}
      recoveryControllerAddress={process.env.NEXT_PUBLIC_RECOVERY_CONTROLLER_ADDRESS}
      demoMockRecovery={process.env.DEMO_MOCK_RECOVERY === "true"}
      transport={transport}
    />
  );
}

function readWidgetConfig(): WidgetConfig | null {
  const params = new URLSearchParams(window.location.search);
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

function createWindowTransport(allowedOrigin: string): KeycatWalletTransport {
  return {
    subscribe(handler) {
      const listener = (event: MessageEvent) => {
        if (event.origin !== allowedOrigin || event.source !== window.parent) {
          return;
        }
        const data = event.data;
        if (!isRecord(data) || data.source !== SDK_SOURCE) {
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
      window.addEventListener("message", listener);
      return () => window.removeEventListener("message", listener);
    },
    respond(request: KeycatTransportRequest, response: KeycatTransportResponse) {
      window.parent.postMessage(
        {
          source: WIDGET_SOURCE,
          id: request.id,
          ...response
        },
        allowedOrigin
      );
    },
    emit(event, params) {
      window.parent.postMessage(
        {
          source: WIDGET_SOURCE,
          event,
          params
        },
        allowedOrigin
      );
    },
    setVisible(visible) {
      window.parent.postMessage(
        {
          source: WIDGET_SOURCE,
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
