"use client";

import * as React from "react";
import {
  KeycatWallet,
  useKeycatProvider,
  useKeycatWalletState,
  useNativeBalance,
  useErc20Balances,
  useActiveDelegations,
  useRecoveryStatus,
  useKeycatActivityLog,
} from "@keycat/wallet-ui";
import {
  getKeycatChain,
  DEFAULT_KEYCAT_CHAIN_NAME,
  KEYCAT_TOKEN_LIST,
  KEYCAT_RECOVERY_DEPLOYMENT,
  type KeycatChainName
} from "@keycat/shared";
import {
  formatUnits,
  parseUnits,
  parseEther,
  encodeFunctionData,
  erc20Abi,
  isAddress,
  type Address,
} from "viem";
import { CatMark, Wordmark } from "../../components/cat";

type Tab = "overview" | "send" | "receive" | "activity" | "permissions" | "security";

export default function AppPage() {
  const chain = React.useMemo(
    () => getKeycatChain((publicEnv(process.env.NEXT_PUBLIC_CHAIN) ?? DEFAULT_KEYCAT_CHAIN_NAME) as KeycatChainName),
    []
  );
  const rpcUrl = publicEnv(process.env.NEXT_PUBLIC_RPC_URL) ?? chain.rpcUrls.default.http[0];
  const bundlerUrl = publicEnv(process.env.NEXT_PUBLIC_BUNDLER_URL);
  const oneShotRelayerUrl = publicEnv(process.env.NEXT_PUBLIC_ONESHOT_RELAYER_URL);
  const oneShotWebhookUrl = publicEnv(process.env.NEXT_PUBLIC_ONESHOT_WEBHOOK_URL);
  const veniceX402Endpoint = publicEnv(process.env.NEXT_PUBLIC_VENICE_X402_ENDPOINT);
  const recoveryControllerAddress =
    publicEnv(process.env.NEXT_PUBLIC_RECOVERY_CONTROLLER_ADDRESS) ??
    KEYCAT_RECOVERY_DEPLOYMENT.keycatRecoveryController;
  const recoveryController = isAddress(recoveryControllerAddress)
    ? recoveryControllerAddress as Address
    : undefined;
  const demoMockRecovery = process.env.NEXT_PUBLIC_DEMO_MOCK_RECOVERY === "true";

  const { controller } = useKeycatProvider({ chain, rpcUrl, aiReviewEndpoint: veniceX402Endpoint });
  const w = useKeycatWalletState({ controller });
  const [showWallet, setShowWallet] = React.useState(false);

  React.useEffect(() => {
    if (!w.isUnlocked) {
      setShowWallet(false);
    }
  }, [w.isUnlocked]);

  const tokens = React.useMemo(
    () =>
      KEYCAT_TOKEN_LIST.tokens
        .filter((t) => t.chainId === chain.id)
        .map((t) => ({
          chainId: t.chainId,
          address: t.address,
          symbol: t.symbol,
          decimals: t.decimals,
          name: t.name,
        })),
    [chain.id]
  );

  const native = useNativeBalance({ chain, rpcUrl, account: w.account });
  const erc20 = useErc20Balances({ chain, rpcUrl, account: w.account, tokens });
  const delegations = useActiveDelegations(w.snapshot);
  const recovery = useRecoveryStatus({
    chain,
    rpcUrl,
    controllerAddress: recoveryController,
    account: w.account,
  });
  const activity = useKeycatActivityLog(w.snapshot);

  const [tab, setTab] = React.useState<Tab>("overview");

  const walletEnv = {
    chain,
    rpcUrl,
    bundlerUrl,
    oneShotRelayerUrl,
    oneShotWebhookUrl,
    veniceX402Endpoint,
    recoveryControllerAddress,
    demoMockRecovery,
    autoLockMs: 10 * 60 * 1000,
    lockOnVisibilityHidden: true
  };

  const walletPanel = (
    <KeycatWallet
      mode="fullpage"
      controller={controller}
      {...walletEnv}
    />
  );

  /* ---------- locked ---------- */
  if (!w.isUnlocked) {
    return (
      <main className="min-h-screen grid place-items-center px-6">
        <div className="w-full max-w-md">
          <div className="flex justify-center mb-7">
            <Wordmark size={36} />
          </div>
          <div>{walletPanel}</div>
          <p className="text-center text-faint text-sm mt-6">
            Self-custody. Keycat never sees your file or your password.
          </p>
        </div>
      </main>
    );
  }

  /* ---------- unlocked ---------- */
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[256px_1fr]">
      <Sidebar tab={tab} setTab={setTab} account={w.account} onLock={() => w.lock()} />
      <main className="px-5 sm:px-8 py-7 max-w-[920px]">
        {recovery.data?.canCancel && recoveryController && (
          <RecoveryBanner onCancel={() => w.cancelRecovery(recoveryController)} />
        )}

        {tab === "overview" && (
          <Overview
            chain={chain}
            account={w.account}
            signerAddress={w.signerAddress}
            native={native}
            erc20={erc20}
            recovery={recovery}
            go={setTab}
          />
        )}
        {tab === "send" && (
          <Send chain={chain} tokens={tokens} native={native} erc20={erc20} wallet={w} />
        )}
        {tab === "receive" && <Receive chain={chain} account={w.account} />}
        {tab === "activity" && <Activity entries={activity} />}
        {tab === "permissions" && <Permissions delegations={delegations} wallet={w} />}
        {tab === "security" && (
          <Security
            account={w.account}
            signerAddress={w.signerAddress}
            signer={w.signer}
            recovery={recovery}
            onCancel={async () => {
              if (recoveryController) {
                await w.cancelRecovery(recoveryController);
              }
            }}
            onLock={() => w.lock()}
            onOpenWallet={() => setShowWallet(true)}
          />
        )}
      </main>

      <div
        className={`fixed inset-0 z-50 grid place-items-center px-4 py-6 ${
          showWallet || w.pending ? "bg-black/30" : "pointer-events-none"
        }`}
        onMouseDown={() => {
          if (!w.pending) {
            setShowWallet(false);
          }
        }}
      >
        <div onMouseDown={(event) => event.stopPropagation()}>
          <KeycatWallet
            mode="fullpage"
            controller={controller}
            suppressUnlockedHome={!showWallet}
            {...walletEnv}
          />
        </div>
      </div>
    </div>
  );
}

/* ============================ sidebar ============================ */
const NAV: { id: Tab; label: string; icon: string }[] = [
  { id: "overview", label: "Overview", icon: "M3 12l9-9 9 9M5 10v10h14V10" },
  { id: "send", label: "Send", icon: "M5 12h14M13 6l6 6-6 6" },
  { id: "receive", label: "Receive", icon: "M12 5v14M6 13l6 6 6-6" },
  { id: "activity", label: "Activity", icon: "M3 12h4l3 8 4-16 3 8h4" },
  { id: "permissions", label: "Permissions", icon: "M12 3l7 3v6c0 5-3 7-7 9-4-2-7-4-7-9V6l7-3z" },
  { id: "security", label: "Security", icon: "M7 11V8a5 5 0 0110 0v3M5 11h14v9H5z" },
];

function Sidebar({
  tab,
  setTab,
  account,
  onLock,
}: {
  tab: Tab;
  setTab: (t: Tab) => void;
  account?: string;
  onLock: () => void;
}) {
  return (
    <aside className="lg:sticky lg:top-0 lg:h-screen flex lg:flex-col gap-1 border-b lg:border-b-0 lg:border-r border-line p-4 overflow-x-auto">
      <div className="hidden lg:block px-2 py-3 mb-2">
        <Wordmark />
      </div>
      <nav className="flex lg:flex-col gap-1 flex-1">
        {NAV.map((n) => (
          <button
            key={n.id}
            onClick={() => setTab(n.id)}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-[15px] font-medium whitespace-nowrap transition-colors ${
              tab === n.id ? "bg-surface2 text-ink" : "text-muted hover:text-ink hover:bg-surface"
            }`}
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" className={tab === n.id ? "text-accent" : ""}>
              <path d={n.icon} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {n.label}
          </button>
        ))}
      </nav>
      <div className="hidden lg:flex items-center gap-2 mt-2 p-2.5 rounded-xl bg-surface border border-line">
        <span className="w-2 h-2 rounded-full bg-ok shrink-0" />
        <span className="font-mono text-[12px] text-muted truncate flex-1">{short(account)}</span>
        <button onClick={onLock} title="Lock" className="text-faint hover:text-ink">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M7 11V8a5 5 0 0110 0M5 11h14v9H5z" stroke="currentColor" strokeWidth="1.8" /></svg>
        </button>
      </div>
    </aside>
  );
}

/* ============================ overview ============================ */
function Overview({ chain, account, signerAddress, native, erc20, recovery, go }: any) {
  return (
    <div>
      <PageTitle title="Overview" sub={`Your smart account on ${chain.name}.`} />
      <div className="card p-6 mb-5">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-11 h-11 rounded-xl grid place-items-center bg-accent">
            <CatMark size={30} />
          </div>
          <div className="min-w-0">
            <div className="text-xs text-muted">Smart account</div>
            <div className="font-mono text-[14px] font-medium truncate">{short(account, 10)}</div>
          </div>
          <CopyBtn value={account} className="ml-auto" />
        </div>
        <div className="text-[13px] text-muted">Native balance</div>
        <div className="text-[32px] font-extrabold tracking-tight">
          {native.loading ? "…" : fmt(native.data?.balance, native.data?.decimals ?? 18)}{" "}
          <span className="text-muted text-lg font-bold">{native.data?.symbol ?? chain.nativeCurrency?.symbol ?? "ETH"}</span>
        </div>
        <div className="grid grid-cols-2 gap-2.5 mt-5">
          <button onClick={() => go("send")} className="btn-primary !py-2.5 text-[14px]">Send</button>
          <button onClick={() => go("receive")} className="btn-ghost !py-2.5 text-[14px]">Receive</button>
        </div>
      </div>

      <h3 className="text-sm font-bold text-muted uppercase tracking-wide mb-3">Assets</h3>
      <div className="card divide-y divide-line">
        {(erc20.data ?? []).length === 0 && !erc20.loading && (
          <Empty>No tokens yet. Receive some to get started.</Empty>
        )}
        {(erc20.data ?? []).map((t: any) => (
          <div key={t.address} className="flex items-center gap-3 px-5 py-4">
            <span className="w-8 h-8 rounded-full bg-surface2 border border-line grid place-items-center font-bold text-[12px]">
              {t.symbol?.[0] ?? "?"}
            </span>
            <div>
              <div className="text-[14px] font-semibold">{t.name ?? t.symbol}</div>
              <div className="text-[12px] text-muted">{t.symbol}</div>
            </div>
            <div className="ml-auto font-mono text-[14px]">{fmt(t.balance, t.decimals)}</div>
          </div>
        ))}
      </div>

      <div className="grid sm:grid-cols-2 gap-4 mt-5">
        <MiniCard
          label="Recovery"
          value={recovery.data?.config.configured ? "Email recovery on" : "Not set up"}
          tone={recovery.data?.config.configured ? "good" : "warn"}
          action={!recovery.data?.config.configured ? { label: "Set up", onClick: () => go("security") } : undefined}
        />
        <MiniCard label="Signer key" value={short(signerAddress, 8)} hint="Rotatable. Recovery moves it." />
      </div>
    </div>
  );
}

/* ============================ send ============================ */
function Send({ chain, tokens, native, erc20, wallet }: any) {
  const nativeSym = native.data?.symbol ?? chain.nativeCurrency?.symbol ?? "ETH";
  const options = [{ kind: "native", symbol: nativeSym, decimals: 18 }, ...tokens.map((t: any) => ({ kind: "erc20", ...t }))];
  const [sel, setSel] = React.useState(0);
  const [to, setTo] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [gasless, setGasless] = React.useState<boolean>(!!wallet.signer?.gasless?.enabled);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [hash, setHash] = React.useState<string | null>(null);

  const asset = options[sel];
  const valid = isAddress(to) && Number(amount) > 0;

  async function submit() {
    setErr(null);
    setHash(null);
    if (!isAddress(to)) return setErr("That doesn't look like a valid address.");
    if (!(Number(amount) > 0)) return setErr("Enter an amount greater than zero.");
    setBusy(true);
    try {
      let tx: any;
      if (asset.kind === "native") {
        tx = { to, value: parseEther(amount) };
      } else {
        const data = encodeFunctionData({
          abi: erc20Abi,
          functionName: "transfer",
          args: [to as `0x${string}`, parseUnits(amount, asset.decimals)],
        });
        tx = { to: asset.address, value: 0n, data };
      }
      // KeycatWallet shows the plain-language review and confirmation before this resolves.
      const h = await wallet.sendTransaction(tx);
      setHash(h);
      setAmount("");
      setTo("");
    } catch (e: any) {
      setErr(e?.message ?? "Transaction failed.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleGasless(v: boolean) {
    setGasless(v);
    try {
      await wallet.setGaslessMode(v);
    } catch {
      setGasless(!v);
    }
  }

  return (
    <div className="max-w-[520px]">
      <PageTitle title="Send" sub="You'll see a plain-language review before you confirm." />
      <div className="card p-6 space-y-4">
        <Field label="Asset">
          <select
            value={sel}
            onChange={(e) => setSel(Number(e.target.value))}
            className="w-full bg-surface2 border border-line rounded-xl px-4 py-3 text-[15px] outline-none focus:border-accent"
          >
            {options.map((o, i) => (
              <option key={i} value={i}>{o.symbol}</option>
            ))}
          </select>
        </Field>
        <Field label="To">
          <input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="0x…"
            className="w-full bg-surface2 border border-line rounded-xl px-4 py-3 font-mono text-[14px] outline-none focus:border-accent"
          />
          {to && !isAddress(to) && <p className="text-[12px] text-accent-tint mt-1.5">Check the address format.</p>}
        </Field>
        <Field label="Amount">
          <div className="flex items-center bg-surface2 border border-line rounded-xl px-4 focus-within:border-accent">
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder="0.0"
              className="flex-1 bg-transparent py-3 text-[15px] outline-none"
            />
            <span className="text-muted text-[14px] font-medium">{asset.symbol}</span>
          </div>
        </Field>

        <label className="flex items-center justify-between gap-3 p-3.5 rounded-xl bg-surface2 border border-line cursor-pointer">
          <span>
            <span className="text-[14.5px] font-semibold block">Gasless</span>
            <span className="text-[12.5px] text-muted">Pay fees in stablecoins, no ETH needed.</span>
          </span>
          <Toggle on={gasless} onChange={toggleGasless} />
        </label>

        {err && <p className="text-[13.5px] text-accent-tint">{err}</p>}
        {hash && <p className="text-[13.5px] text-ok font-mono break-all">Sent: {hash}</p>}

        <button disabled={!valid || busy} onClick={submit} className="btn-primary w-full !py-3.5 disabled:opacity-40 disabled:cursor-not-allowed">
          {busy ? "Confirm in wallet…" : "Review and send"}
        </button>
      </div>
    </div>
  );
}

/* ============================ receive ============================ */
function Receive({ chain, account }: any) {
  return (
    <div className="max-w-[520px]">
      <PageTitle title="Receive" sub={`Only send assets on ${chain.name} to this address.`} />
      <div className="card p-6 text-center">
        <div className="w-11 h-11 rounded-xl grid place-items-center bg-accent mx-auto mb-5">
          <CatMark size={30} />
        </div>
        <div className="text-xs text-muted mb-2">Your smart account address</div>
        <div className="font-mono text-[15px] break-all bg-surface2 border border-line rounded-xl p-4 mb-4">
          {account}
        </div>
        <CopyBtn value={account} block />
        <p className="text-[12.5px] text-faint mt-4">
          Sending from another wallet or an exchange? Double-check you&apos;re on {chain.name}.
        </p>
      </div>
    </div>
  );
}

/* ============================ activity ============================ */
function Activity({ entries }: { entries: any[] }) {
  return (
    <div className="max-w-[640px]">
      <PageTitle title="Activity" sub="Everything you've approved this session. Clears when you lock." />
      <div className="card divide-y divide-line">
        {entries.length === 0 && <Empty>Nothing yet. Your signed actions show up here.</Empty>}
        {entries.map((e) => (
          <div key={e.id} className="flex items-center gap-3 px-5 py-4">
            <span className={`w-9 h-9 rounded-xl grid place-items-center ${e.status === "approved" ? "text-accent" : "text-faint"}`}
              style={{ background: "rgba(110,139,255,.08)", border: "1px solid rgba(110,139,255,.18)" }}>
              <Glyph kind={e.kind} />
            </span>
            <div className="min-w-0">
              <div className="text-[14px] font-semibold capitalize">{label(e.kind)}</div>
              <div className="text-[12px] text-muted truncate">{e.origin}</div>
            </div>
            <div className="ml-auto text-right">
              <div className={`text-[12.5px] font-semibold ${e.status === "approved" ? "text-ok" : "text-faint"}`}>
                {e.status}
              </div>
              <div className="text-[11px] text-faint">{time(e.createdAt)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============================ permissions ============================ */
function Permissions({ delegations, wallet }: { delegations: any[]; wallet: any }) {
  async function revoke(d: any) {
    if (d.kind === "gasless") await wallet.setGaslessMode(false);
    else if (d.kind === "ai-review") await wallet.setAiReviewMode(false);
  }
  return (
    <div className="max-w-[640px]">
      <PageTitle title="Permissions" sub="Spending allowances you've granted. Revoke any, anytime." />
      <div className="space-y-3">
        {delegations.length === 0 && (
          <div className="card"><Empty>No active permissions. You&apos;re in full manual control.</Empty></div>
        )}
        {delegations.map((d) => (
          <div key={d.id} className="card p-5 flex items-start gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[15px] font-bold">{d.kind === "gasless" ? "Gasless transactions" : "AI transaction review"}</span>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded-pill bg-surface2 border border-line text-muted">{d.state}</span>
              </div>
              <div className="text-[13px] text-muted space-y-0.5">
                {d.dailyUsdLimit && <div>Up to {d.dailyUsdLimit} per day</div>}
                {d.payeeAddress && <div className="font-mono">Pays {short(d.payeeAddress, 8)}</div>}
                {d.expiresAt && <div>Expires {date(d.expiresAt)}</div>}
              </div>
            </div>
            <button onClick={() => revoke(d)} className="btn-ghost !py-2 !px-4 text-[13px]">Revoke</button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============================ security ============================ */
function Security({ account, signerAddress, signer, recovery, onCancel, onLock, onOpenWallet }: any) {
  const configured = !!recovery.data?.config.configured;
  return (
    <div className="max-w-[640px]">
      <PageTitle title="Security" sub="Your keys, your recovery, your rules." />

      <div className="card p-6 mb-4">
        <h3 className="text-[16px] font-bold mb-1">Email recovery</h3>
        <p className="text-[14px] text-muted mb-4">
          {configured
            ? "Recovery is on. If you ever lose your file, your email brings your wallet back."
            : "Add a recovery email so you can always get back in, even without your file."}
        </p>
        {recovery.data?.pending.exists && (
          <div className="rounded-xl bg-surface2 border border-line p-3.5 mb-4 text-[13.5px]">
            A recovery is in its safety window.
            {recovery.data.canCancel && (
              <button onClick={onCancel} className="ml-2 text-accent font-semibold">Cancel it</button>
            )}
          </div>
        )}
        {/* INTEGRATION: enabling recovery post-creation runs configureRecovery, which the
            KeycatWallet settings flow owns. Surface it here. */}
        <span className={`tag ${configured ? "" : "opacity-80"}`}>{configured ? "Recovery on" : "Recovery off"}</span>
      </div>

      <div className="card p-6 mb-4">
        <h3 className="text-[16px] font-bold mb-3">Your addresses</h3>
        <Row label="Smart account" value={account} copy />
        <Row label="Signer key" value={signerAddress} copy hint="This is what recovery rotates." />
        {signer?.mode && <Row label="Mode" value={String(signer.mode)} />}
      </div>

      <div className="card p-6">
        <h3 className="text-[16px] font-bold mb-1">Password and device unlock</h3>
        <p className="text-[14px] text-muted mb-4">
          Change your password or your fingerprint unlock from the wallet panel. A fresh file
          is generated and the old one stops working.
        </p>
        <button onClick={onOpenWallet} className="btn-primary !py-2.5 text-[14px] mr-2">Open wallet panel</button>
        <button onClick={onLock} className="btn-ghost !py-2.5 text-[14px]">Lock wallet</button>
      </div>
    </div>
  );
}

/* ============================ small parts ============================ */
function PageTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-6">
      <h1 className="font-display text-[26px] font-semibold tracking-tight">{title}</h1>
      {sub && <p className="text-muted text-[15px] mt-1">{sub}</p>}
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[13px] font-semibold text-muted mb-1.5 block">{label}</span>
      {children}
    </label>
  );
}
function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={`w-11 h-6 rounded-pill relative transition-colors ${on ? "bg-accent" : "bg-line2"}`}
      role="switch"
      aria-checked={on}
    >
      <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-base transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}
function MiniCard({ label, value, tone, hint, action }: any) {
  return (
    <div className="card p-5">
      <div className="text-[12px] text-muted mb-1">{label}</div>
      <div className={`text-[16px] font-bold ${tone === "good" ? "text-ok" : tone === "warn" ? "text-accent-tint" : ""}`}>{value}</div>
      {hint && <div className="text-[12px] text-faint mt-1">{hint}</div>}
      {action && <button onClick={action.onClick} className="text-accent text-[13px] font-semibold mt-2">{action.label}</button>}
    </div>
  );
}
function Row({ label, value, copy, hint }: { label: string; value?: string; copy?: boolean; hint?: string }) {
  return (
    <div className="flex items-center gap-3 py-2.5 border-t border-line first:border-t-0">
      <div className="min-w-[110px] text-[13px] text-muted">{label}</div>
      <div className="font-mono text-[13px] truncate flex-1">{value}</div>
      {copy && <CopyBtn value={value} />}
      {hint && <span className="text-[11px] text-faint hidden sm:block">{hint}</span>}
    </div>
  );
}
function RecoveryBanner({ onCancel }: { onCancel: () => void }) {
  return (
    <div className="rounded-card p-4 mb-5 flex items-center gap-3"
      style={{ background: "rgba(110,139,255,.1)", border: "1px solid rgba(110,139,255,.3)" }}>
      <span className="text-[14px]">A recovery was requested on your account. If this wasn&apos;t you, cancel it now.</span>
      <button onClick={onCancel} className="btn-primary !py-2 !px-4 text-[13px] ml-auto">Cancel recovery</button>
    </div>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-5 py-10 text-center text-muted text-[14px]">{children}</div>;
}
function CopyBtn({ value, block, className = "" }: { value?: string; block?: boolean; className?: string }) {
  const [done, setDone] = React.useState(false);
  return (
    <button
      onClick={() => {
        if (value && navigator.clipboard) {
          navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }
      }}
      className={`${block ? "btn-ghost w-full !py-2.5 text-[14px]" : "text-faint hover:text-ink"} ${className}`}
    >
      {done ? "Copied" : block ? "Copy address" : <CopyIcon />}
    </button>
  );
}

/* ---------- format + icons ---------- */
function publicEnv(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
function short(a?: string, n = 4) {
  return a ? `${a.slice(0, n + 2)}…${a.slice(-4)}` : "";
}
function fmt(v?: bigint, d = 18) {
  if (v === undefined) return "0";
  const s = formatUnits(v, d);
  const n = Number(s);
  return n === 0 ? "0" : n < 0.0001 ? "<0.0001" : n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}
function time(t: number) {
  return new Date(t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
function date(t: number) {
  return new Date(t * (t < 1e12 ? 1000 : 1)).toLocaleDateString();
}
function label(k: string) {
  return ({ connect: "Connected", personal_sign: "Signed message", eth_signTypedData_v4: "Signed data", eth_sendTransaction: "Sent transaction" } as any)[k] ?? k;
}
function Glyph({ kind }: { kind: string }) {
  const d =
    kind === "eth_sendTransaction" ? "M5 12h14M13 6l6 6-6 6" :
    kind === "connect" ? "M8 9l-4 3 4 3M16 9l4 3-4 3" :
    "M4 7h16M4 12h10";
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d={d} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function CopyIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.8" /><path d="M5 15V5a2 2 0 012-2h8" stroke="currentColor" strokeWidth="1.8" /></svg>;
}
