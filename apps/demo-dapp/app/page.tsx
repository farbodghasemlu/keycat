"use client";

import { useEffect, useMemo, useState } from "react";

type Eip1193Provider = {
  request(args: { method: string; params?: unknown }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
};

type Eip6963ProviderInfo = {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
};

type Eip6963AnnounceEvent = CustomEvent<{
  info: Eip6963ProviderInfo;
  provider: Eip1193Provider;
}>;

declare global {
  interface Window {
    KeycatVault?: {
      init(options?: { chainId?: number; widgetUrl?: string }): Promise<Eip1193Provider>;
    };
  }
}

const SEPOLIA_CHAIN_ID = 11155111;
const USDC_SEPOLIA = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const KITTY_ROUTER = "0x0000000000000000000000000000000000c0ffee";
const SELF_SEND_VALUE = "0x5af3107a4000";
const WEI_PER_ETH = BigInt("1000000000000000000");
const MAX_UINT256 = (1n << 256n) - 1n;

export default function Page() {
  const [provider, setProvider] = useState<Eip1193Provider | null>(null);
  const [providerInfo, setProviderInfo] = useState<Eip6963ProviderInfo | null>(null);
  const [address, setAddress] = useState<string>("");
  const [balance, setBalance] = useState<string>("0");
  const [status, setStatus] = useState("Loading Keycat...");
  const [busy, setBusy] = useState<string>("");
  const [lastHash, setLastHash] = useState<string>("");
  const [signature, setSignature] = useState<string>("");

  const widgetUrl = useMemo(() => getWidgetUrl(), []);
  const sdkUrl = useMemo(() => getSdkUrl(), []);

  useEffect(() => {
    let disposed = false;
    const onAnnounce = (event: Event) => {
      const detail = (event as Eip6963AnnounceEvent).detail;
      if (detail?.info?.rdns === "net.keycat") {
        setProvider(detail.provider);
        setProviderInfo(detail.info);
        setStatus("Keycat discovered.");
      }
    };

    window.addEventListener("eip6963:announceProvider", onAnnounce);

    async function load() {
      try {
        await loadScript(sdkUrl);
        if (disposed) {
          return;
        }
        const keycat = await window.KeycatVault?.init({
          chainId: SEPOLIA_CHAIN_ID,
          widgetUrl
        });
        if (keycat) {
          setProvider(keycat);
          setStatus("Keycat ready.");
        }
        window.dispatchEvent(new Event("eip6963:requestProvider"));
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Could not load Keycat.");
      }
    }

    void load();
    window.dispatchEvent(new Event("eip6963:requestProvider"));

    return () => {
      disposed = true;
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
    };
  }, [sdkUrl, widgetUrl]);

  useEffect(() => {
    if (!provider) {
      return undefined;
    }
    const onAccountsChanged = (accounts: unknown) => {
      const next = Array.isArray(accounts) && typeof accounts[0] === "string" ? accounts[0] : "";
      setAddress(next);
      if (next) {
        void refreshBalance(provider, next, setBalance);
      }
    };
    provider.on?.("accountsChanged", onAccountsChanged);
    return () => provider.removeListener?.("accountsChanged", onAccountsChanged);
  }, [provider]);

  async function connect() {
    if (!provider) {
      return;
    }
    setBusy("connect");
    setStatus("Connecting...");
    try {
      const accounts = (await provider.request({
        method: "eth_requestAccounts"
      })) as string[];
      const next = accounts[0] ?? "";
      setAddress(next);
      setStatus(next ? "Connected." : "No account returned.");
      if (next) {
        await refreshBalance(provider, next, setBalance);
      }
    } catch (error) {
      setStatus(readError(error));
    } finally {
      setBusy("");
    }
  }

  async function signMessage() {
    if (!provider || !address) {
      return;
    }
    setBusy("sign");
    setStatus("Waiting for signature...");
    try {
      const message = `KittySwap quote approval for ${address}`;
      const result = await provider.request({
        method: "personal_sign",
        params: [toHex(message), address]
      });
      setSignature(String(result));
      setStatus("Message signed.");
    } catch (error) {
      setStatus(readError(error));
    } finally {
      setBusy("");
    }
  }

  async function sendToSelf() {
    if (!provider || !address) {
      return;
    }
    setBusy("send");
    setStatus("Sending 0.0001 ETH to self...");
    try {
      const hash = await provider.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: address,
            to: address,
            value: SELF_SEND_VALUE
          }
        ]
      });
      setLastHash(String(hash));
      setStatus("Self-send submitted.");
      await refreshBalance(provider, address, setBalance);
    } catch (error) {
      setStatus(readError(error));
    } finally {
      setBusy("");
    }
  }

  async function approveUsdc() {
    if (!provider || !address) {
      return;
    }
    setBusy("approve");
    setStatus("Approving USDC...");
    try {
      const hash = await provider.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: address,
            to: USDC_SEPOLIA,
            data: encodeApprove(KITTY_ROUTER, MAX_UINT256),
            value: "0x0"
          }
        ]
      });
      setLastHash(String(hash));
      setStatus("Approve submitted.");
    } catch (error) {
      setStatus(readError(error));
    } finally {
      setBusy("");
    }
  }

  return (
    <main className="ks-page">
      <style>{STYLES}</style>
      <section className="ks-shell">
        <header className="ks-header">
          <div className="ks-brand">
            <div className="ks-logo" aria-hidden="true" />
            <div>
              <strong>KittySwap</strong>
              <span>Sepolia DeFi harness</span>
            </div>
          </div>
          <button
            className="ks-connect"
            disabled={!provider || busy === "connect"}
            type="button"
            onClick={connect}
          >
            {address ? shortAddress(address) : busy === "connect" ? "Connecting..." : "Connect"}
          </button>
        </header>

        <section className="ks-grid">
          <div className="ks-swap-panel">
            <div className="ks-panel-head">
              <h1>Swap test flow</h1>
              <span>USDC / ETH</span>
            </div>
            <div className="ks-token-row">
              <TokenMark label="ETH" tone="green" />
              <div>
                <span>From</span>
                <strong>0.0001 ETH</strong>
              </div>
            </div>
            <div className="ks-token-row">
              <TokenMark label="USDC" tone="coral" />
              <div>
                <span>Approve</span>
                <strong>Unlimited USDC</strong>
              </div>
            </div>
            <div className="ks-button-grid">
              <button disabled={!address || busy === "sign"} type="button" onClick={signMessage}>
                {busy === "sign" ? "Signing..." : "Sign message"}
              </button>
              <button disabled={!address || busy === "send"} type="button" onClick={sendToSelf}>
                {busy === "send" ? "Sending..." : "Send to self"}
              </button>
              <button disabled={!address || busy === "approve"} type="button" onClick={approveUsdc}>
                {busy === "approve" ? "Approving..." : "Approve USDC"}
              </button>
            </div>
          </div>

          <aside className="ks-side-panel">
            <div>
              <span className="ks-label">Provider</span>
              <strong>{providerInfo?.name ?? "Keycat"}</strong>
            </div>
            <div>
              <span className="ks-label">Account</span>
              <strong>{address || "Not connected"}</strong>
            </div>
            <div>
              <span className="ks-label">Balance</span>
              <strong>{balance} ETH</strong>
            </div>
            <div>
              <span className="ks-label">Status</span>
              <strong>{status}</strong>
            </div>
            {lastHash ? (
              <div>
                <span className="ks-label">Last tx</span>
                <strong>{shortHash(lastHash)}</strong>
              </div>
            ) : null}
            {signature ? (
              <div>
                <span className="ks-label">Signature</span>
                <strong>{shortHash(signature)}</strong>
              </div>
            ) : null}
          </aside>
        </section>
      </section>
    </main>
  );
}

function TokenMark({ label, tone }: { label: string; tone: "green" | "coral" }) {
  return <div className={`ks-token ks-token--${tone}`}>{label.slice(0, 1)}</div>;
}

function getSdkUrl(): string {
  if (typeof window === "undefined") {
    return "https://keycat.net/sdk/widget.js";
  }
  if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
    return "http://localhost:3000/sdk/widget.js";
  }
  return "https://keycat.net/sdk/widget.js";
}

function getWidgetUrl(): string {
  const configured = process.env.NEXT_PUBLIC_WIDGET_URL;
  if (configured) {
    return configured;
  }
  if (typeof window !== "undefined" && window.location.hostname === "localhost") {
    return "http://localhost:3000/widget";
  }
  return "https://keycat.net/widget";
}

function loadScript(src: string): Promise<void> {
  if (window.KeycatVault) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Keycat SDK failed to load.")), {
        once: true
      });
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset.chainId = String(SEPOLIA_CHAIN_ID);
    script.dataset.widgetUrl = getWidgetUrl();
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Keycat SDK failed to load."));
    document.head.append(script);
  });
}

async function refreshBalance(
  provider: Eip1193Provider,
  account: string,
  setBalance: (value: string) => void
) {
  const balanceHex = String(
    await provider.request({
      method: "eth_getBalance",
      params: [account, "latest"]
    })
  );
  setBalance(formatEth(BigInt(balanceHex)));
}

function encodeApprove(spender: string, amount: bigint): string {
  return `0x095ea7b3${padAddress(spender)}${padUint256(amount)}`;
}

function padAddress(address: string): string {
  return address.toLowerCase().replace(/^0x/u, "").padStart(64, "0");
}

function padUint256(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}

function toHex(message: string): string {
  const bytes = new TextEncoder().encode(message);
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function formatEth(value: bigint): string {
  const whole = value / WEI_PER_ETH;
  const fraction = value % WEI_PER_ETH;
  const fractionText = fraction.toString().padStart(18, "0").slice(0, 5);
  return `${whole}.${fractionText}`;
}

function readError(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed.";
}

function shortAddress(value: string): string {
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function shortHash(value: string): string {
  return `${value.slice(0, 10)}...${value.slice(-8)}`;
}

const STYLES = `
.ks-page {
  min-height: 100vh;
  background: #f3f6f1;
  color: #17221f;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  padding: 28px;
}
.ks-shell {
  margin: 0 auto;
  max-width: 1120px;
}
.ks-header {
  align-items: center;
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 24px;
}
.ks-brand {
  align-items: center;
  display: flex;
  gap: 12px;
}
.ks-brand strong {
  display: block;
  font-size: 1.1rem;
}
.ks-brand span,
.ks-label {
  color: #66746d;
  font-size: 0.86rem;
}
.ks-logo {
  background: #de684f;
  border-radius: 8px;
  height: 44px;
  position: relative;
  width: 44px;
}
.ks-logo::before,
.ks-logo::after {
  border-bottom: 14px solid #de684f;
  border-left: 8px solid transparent;
  border-right: 8px solid transparent;
  content: "";
  position: absolute;
  top: -8px;
}
.ks-logo::before {
  left: 6px;
}
.ks-logo::after {
  right: 6px;
}
.ks-connect,
.ks-button-grid button {
  background: #17221f;
  border: 1px solid #17221f;
  border-radius: 8px;
  color: white;
  cursor: pointer;
  font: inherit;
  font-weight: 800;
  min-height: 42px;
  padding: 10px 14px;
}
.ks-connect:disabled,
.ks-button-grid button:disabled {
  cursor: wait;
  opacity: 0.55;
}
.ks-grid {
  align-items: start;
  display: grid;
  gap: 18px;
  grid-template-columns: minmax(0, 1.5fr) minmax(280px, 0.85fr);
}
.ks-swap-panel,
.ks-side-panel {
  background: #fffefa;
  border: 1px solid #d9e0d8;
  border-radius: 8px;
  box-shadow: 0 18px 50px rgba(23, 34, 31, 0.12);
  padding: 18px;
}
.ks-panel-head {
  align-items: start;
  display: flex;
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 16px;
}
.ks-panel-head h1 {
  font-size: clamp(1.8rem, 4vw, 3.8rem);
  line-height: 1;
  margin: 0;
}
.ks-panel-head span {
  background: #fff3d6;
  border: 1px solid #e2c36d;
  border-radius: 999px;
  color: #5c4717;
  font-size: 0.82rem;
  font-weight: 800;
  padding: 7px 10px;
}
.ks-token-row {
  align-items: center;
  background: #f6f8f4;
  border: 1px solid #dbe3dc;
  border-radius: 8px;
  display: grid;
  gap: 12px;
  grid-template-columns: auto 1fr;
  margin-top: 10px;
  padding: 14px;
}
.ks-token-row span {
  color: #66746d;
  display: block;
  font-size: 0.85rem;
}
.ks-token-row strong {
  display: block;
  font-size: 1.3rem;
}
.ks-token {
  align-items: center;
  border-radius: 999px;
  color: white;
  display: grid;
  font-weight: 900;
  height: 42px;
  justify-items: center;
  width: 42px;
}
.ks-token--green {
  background: #1f8a6b;
}
.ks-token--coral {
  background: #de684f;
}
.ks-button-grid {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin-top: 16px;
}
.ks-side-panel {
  display: grid;
  gap: 14px;
}
.ks-side-panel div {
  border-bottom: 1px solid #e3e8e3;
  display: grid;
  gap: 4px;
  padding-bottom: 12px;
}
.ks-side-panel div:last-child {
  border-bottom: 0;
  padding-bottom: 0;
}
.ks-side-panel strong {
  overflow-wrap: anywhere;
}
@media (max-width: 860px) {
  .ks-page {
    padding: 14px;
  }
  .ks-grid,
  .ks-button-grid {
    grid-template-columns: 1fr;
  }
  .ks-header {
    align-items: stretch;
    flex-direction: column;
  }
}
`;
