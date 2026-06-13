"use client";

import { KeycatWallet } from "@keycat/wallet-ui";
import { useEffect, useState } from "react";

export default function AppPage() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return null;
  }

  return (
    <KeycatWallet
      mode="fullpage"
      chainId={getChainId(process.env.NEXT_PUBLIC_CHAIN)}
    />
  );
}

function getChainId(value?: string): number | undefined {
  if (!value || value === "sepolia") {
    return 11155111;
  }
  if (value === "base-sepolia") {
    return 84532;
  }
  const numeric = Number(value);
  return Number.isInteger(numeric) ? numeric : undefined;
}
