"use client";

import {
  createKeycatWindowTransport,
  KeycatWallet,
  readKeycatWidgetConfig
} from "@keycat/wallet-ui";
import { useEffect, useMemo, useState } from "react";

export default function WidgetPage() {
  const [config, setConfig] = useState<ReturnType<typeof readKeycatWidgetConfig>>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setConfig(readKeycatWidgetConfig());
  }, []);

  const transport = useMemo(
    () =>
      config
        ? createKeycatWindowTransport({ allowedOrigin: config.allowedOrigin })
        : undefined,
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
