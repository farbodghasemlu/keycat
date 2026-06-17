"use client";

import * as React from "react";
import { Nav, Footer } from "../../components/chrome";

const SECTIONS = [
  { id: "quickstart", label: "Quickstart" },
  { id: "sdk", label: "SDK reference" },
  { id: "discovery", label: "wagmi & EIP-6963" },
  { id: "smart-accounts", label: "Smart accounts" },
  { id: "ai-review", label: "AI review & x402" },
  { id: "recovery", label: "Recovery" },
  { id: "keystore", label: "Keystore format" },
  { id: "self-hosting", label: "Self-hosting" },
  { id: "security", label: "Security model" },
];

export default function DocsPage() {
  const [active, setActive] = React.useState("quickstart");
  React.useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (vis[0]) setActive(vis[0].target.id);
      },
      { rootMargin: "-80px 0px -70% 0px", threshold: 0 }
    );
    SECTIONS.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) io.observe(el);
    });
    return () => io.disconnect();
  }, []);

  return (
    <>
      <Nav />
      <div className="mx-auto max-w-site px-6 pt-12 pb-8">
        <span className="tag">Documentation</span>
        <h1 className="font-display text-[clamp(32px,4vw,46px)] font-semibold tracking-tight mt-4 mb-3">
          Build with Keycat.
        </h1>
        <p className="text-muted text-lg max-w-[640px]">
          Everything you need to drop a real, recoverable wallet into your app, plus the
          technical detail behind how Keycat keeps custody with the user and nothing with us.
        </p>
      </div>

      <div className="mx-auto max-w-site px-6 pb-20 grid lg:grid-cols-[220px_1fr] gap-12">
        {/* TOC */}
        <aside className="hidden lg:block">
          <nav className="sticky top-[90px] space-y-1">
            {SECTIONS.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className={`block px-3 py-2 rounded-lg text-[14px] transition-colors ${
                  active === s.id ? "bg-surface2 text-ink font-semibold" : "text-muted hover:text-ink"
                }`}
              >
                {s.label}
              </a>
            ))}
          </nav>
        </aside>

        {/* CONTENT */}
        <div className="max-w-[760px] min-w-0">
          {/* QUICKSTART */}
          <Doc id="quickstart" title="Quickstart">
            <P>
              Keycat ships as a single script. Drop it in, call <C>init</C>, and you get a
              standard EIP-1193 provider backed by a full smart-account wallet. Your users
              create or unlock their wallet inside Keycat&apos;s own sandboxed UI, so your app
              never touches a key or a password.
            </P>
            <Code label="index.html">{`<script src="https://cdn.keycat.net/widget.js"></script>
<script>
  const wallet = await KeycatVault.init({ chainId: 8453 });

  // Standard EIP-1193 from here on
  const [account] = await wallet.request({ method: 'eth_requestAccounts' });

  const signature = await wallet.request({
    method: 'personal_sign',
    params: ['Hello from my dApp', account],
  });
</script>`}</Code>
            <P>
              That is the whole integration. The wallet UI appears only when a request needs
              the user, for example connecting or signing, and stays out of the way otherwise.
            </P>
          </Doc>

          {/* SDK */}
          <Doc id="sdk" title="SDK reference">
            <H3>init(options)</H3>
            <P>Creates the wallet and returns an EIP-1193 provider.</P>
            <Table
              head={["Option", "Type", "Notes"]}
              rows={[
                ["chainId", "number", "Network the wallet operates on."],
                ["widgetUrl", "string (optional)", "Override the hosted widget origin to self-host."],
              ]}
            />
            <H3>Supported request methods</H3>
            <P>These are handled by Keycat directly and prompt the user when needed:</P>
            <Table
              head={["Method", "Returns"]}
              rows={[
                ["eth_chainId", "0x-prefixed chain id"],
                ["net_version", "decimal chain id string"],
                ["eth_accounts", "connected accounts"],
                ["eth_requestAccounts", "prompts to connect, then accounts"],
                ["personal_sign", "prompts, then signature"],
                ["eth_signTypedData_v4", "prompts, then signature"],
                ["eth_sendTransaction", "prompts with a review, then tx hash"],
              ]}
            />
            <P>
              All standard read methods (<C>eth_call</C>, <C>eth_getBalance</C>,{" "}
              <C>eth_getLogs</C>, <C>eth_getTransactionReceipt</C>, fee and block queries, and
              the rest) are proxied to the network and need no user interaction.
            </P>
            <H3>Events</H3>
            <Table
              head={["Event", "Payload"]}
              rows={[
                ["accountsChanged", "string[] of accounts. Fires after a recovery rotates the owner."],
                ["disconnect", "{ code: 4900, message } when the wallet locks or the bridge closes"],
              ]}
            />
            <H3>Error codes</H3>
            <Table
              head={["Code", "Meaning"]}
              rows={[
                ["4001", "User rejected, or the wallet locked during a pending request"],
                ["4100", "Unlock or account authorization required, or account mismatch"],
                ["4200", "Unsupported method or capability"],
                ["4900", "Disconnected or the bridge closed"],
                ["4901", "Wrong chain for a transaction"],
                ["-32002", "Another interactive request is already pending"],
                ["-32602", "Invalid params"],
                ["-32603", "Internal request failure"],
              ]}
            />
          </Doc>

          {/* DISCOVERY */}
          <Doc id="discovery" title="wagmi, RainbowKit & EIP-6963">
            <P>
              Keycat announces itself over EIP-6963, so any library that supports multi-wallet
              discovery finds it with no extra configuration. In wagmi or RainbowKit it simply
              appears in the wallet list as Keycat once the script has loaded.
            </P>
            <Code label="provider.ts">{`// The injected provider is also discoverable. After the script loads,
// Keycat dispatches an EIP-6963 announcement that wagmi / RainbowKit pick up.
// No connector wiring needed; just make sure widget.js is on the page.`}</Code>
            <P>
              If you manage connections yourself, hold on to the object returned by{" "}
              <C>init</C> and treat it as you would any EIP-1193 provider.
            </P>
          </Doc>

          {/* SMART ACCOUNTS */}
          <Doc id="smart-accounts" title="Smart accounts">
            <P>
              Every Keycat wallet is a smart account. The user&apos;s keystore key is the
              account&apos;s owner signer, which is what makes both gasless transactions and
              recovery possible. Two addresses matter:
            </P>
            <Table
              head={["Address", "What it is"]}
              rows={[
                ["Account", "The smart account. This is what eth_requestAccounts returns and what holds funds."],
                ["Signer", "The keystore key that owns the account. Rotatable, and changed by recovery."],
              ]}
            />
            <P>
              New accounts deploy counterfactually, so the address exists before the first
              transaction and the first send deploys it. With gasless mode on, transactions are
              relayed and fees settle in stablecoins, so a user with no ETH can still transact.
            </P>
            <Callout>
              An existing key can also be upgraded in place using EIP-7702. On that path,
              recovery restores access after a lost key but cannot fully expel a stolen one,
              because the original key keeps root authority. A fresh Keycat account has full
              expulsion on recovery. The wallet explains this when the user chooses.
            </Callout>
          </Doc>

          {/* AI REVIEW */}
          <Doc id="ai-review" title="AI review & x402">
            <P>
              Before a user signs, Keycat can show a plain-language explanation of the
              transaction and flag risks such as unlimited approvals or unknown contracts. The
              review is optional and the user turns it on themselves.
            </P>
            <P>
              It is paid per use, directly from the user&apos;s smart account, using an x402
              micropayment authorized by a tightly scoped ERC-7710 delegation. Only public
              transaction details are sent for review: the target, value, calldata, and chain.
              No keys, passwords, or keystore data ever leave the wallet.
            </P>
            <Callout>
              Design for a short budget. The review runs against a five second timeout, and if
              it is unavailable the wallet falls back to a local decode and never blocks
              signing.
            </Callout>
          </Doc>

          {/* RECOVERY */}
          <Doc id="recovery" title="Recovery">
            <P>
              Recovery is verified entirely on-chain by a zero-knowledge proof of a DKIM-signed
              email, using ZK Email&apos;s audited recovery stack. The user emails a recovery
              command from their enrolled address, a proof attests it without revealing the
              address, the on-chain controller checks it, a timelock opens, and then the
              account&apos;s owner rotates to a fresh key.
            </P>
            <H3>What your app should handle</H3>
            <P>
              A recovery changes the account&apos;s owner key, not the account address. Listen
              for <C>accountsChanged</C> and treat a new signer as the same account. Funds,
              history, and address are unchanged.
            </P>
            <Table
              head={["Stage", "Behavior"]}
              rows={[
                ["Request", "A RecoveryRequested event opens a timelock window."],
                ["Cancel", "The current owner can cancel during the window if the request was not theirs."],
                ["Execute", "After the timelock, the owner signer rotates. The old keystore stops working."],
              ]}
            />
          </Doc>

          {/* KEYSTORE */}
          <Doc id="keystore" title="Keystore format">
            <P>
              The keystore is a single self-describing JSON file. It carries everything needed
              to decrypt it given the user&apos;s secrets, and nothing that identifies the user.
              This is the v1 shape, useful for auditors and for importers.
            </P>
            <Code label="keycat-keystore-v1.json">{`{
  "kind": "keycat-keystore",
  "version": 1,
  "address": "0x7a3f...9C21",
  "crypto": {
    "cipher": "aes-256-gcm",
    "ciphertext": "...",
    "iv": "...",
    "kdf": "argon2id",
    "kdfparams": {
      "memoryKiB": 65536,
      "iterations": 3,
      "parallelism": 1,
      "salt": "..."
    },
    "factors": ["password", "webauthn-prf"],
    "webauthn": {
      "credentialIdB64url": "...",
      "rpId": "keycat.net",
      "prfSaltB64url": "..."
    }
  },
  "meta": { "createdAt": 1734200000000, "label": "Main" }
}`}</Code>
            <P>
              The private key is sealed with AES-256-GCM. The key that unseals it is derived
              from the password with Argon2id, and if the device factor is enabled, the
              WebAuthn PRF output is folded into that derivation. A wrong password, a wrong
              device, or a tampered file all fail the same way, with no hint about which.
            </P>
          </Doc>

          {/* SELF-HOSTING */}
          <Doc id="self-hosting" title="Self-hosting">
            <P>
              Keycat does not have to be loaded from keycat.net. The widget is a static bundle
              you can serve yourself, pin by hash, or run from IPFS. Point your integration at
              your own copy with the <C>widgetUrl</C> option.
            </P>
            <Code label="self-host.html">{`<script src="https://your-cdn.example/keycat/widget.js"
        integrity="sha384-..." crossorigin="anonymous"></script>
<script>
  const wallet = await KeycatVault.init({
    chainId: 8453,
    widgetUrl: 'https://your-cdn.example/keycat/'
  });
</script>`}</Code>
            <P>
              Use a Subresource Integrity hash so the browser refuses any bundle that does not
              match. Because the contracts live on-chain and the keystore is the user&apos;s,
              a self-hosted Keycat depends on nothing of ours.
            </P>
          </Doc>

          {/* SECURITY */}
          <Doc id="security" title="Security model">
            <P>
              Keycat holds nothing. There is no server, database, or API key on our side, so
              the trust sits where it should: with the user&apos;s file, their password, and
              their email.
            </P>
            <Table
              head={["Threat", "What protects the user"]}
              rows={[
                ["Stolen keystore file", "Argon2id plus AES-256-GCM, and an optional device factor. The key is also rotatable."],
                ["Password guessing", "Memory-hard derivation makes offline brute force expensive; a device factor makes it infeasible."],
                ["Email account compromise", "A recovery only opens a timelock the real owner can cancel before it executes."],
                ["Our website compromised", "There is no vault of keys to steal. Self-hosting and SRI remove even the code-delivery risk."],
                ["Phishing dApp", "The AI review shows what a transaction actually does, and delegations are scoped and capped."],
              ]}
            />
            <Callout>
              Found something? Responsible disclosure is welcome at security@keycat.net. The
              recovery controller and keystore library are the surfaces we put through audit
              before any release that holds real funds, and we publish the reports.
            </Callout>
          </Doc>
        </div>
      </div>
      <Footer />
    </>
  );
}

/* ---------- doc primitives ---------- */
function Doc({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 mb-16">
      <h2 className="font-display text-[28px] font-semibold tracking-tight mb-4 pb-3 border-b border-line">
        {title}
      </h2>
      <div className="space-y-4">{children}</div>
    </section>
  );
}
function P({ children }: { children: React.ReactNode }) {
  return <p className="text-[15.5px] text-muted leading-relaxed">{children}</p>;
}
function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[17px] font-bold text-ink mt-7 mb-1">{children}</h3>;
}
function C({ children }: { children: React.ReactNode }) {
  return <code className="font-mono text-[13px] bg-surface2 border border-line rounded px-1.5 py-0.5 text-accent-tint">{children}</code>;
}
function Code({ label, children }: { label: string; children: string }) {
  return (
    <div className="rounded-card overflow-hidden border border-line2" style={{ background: "#0E0E16" }}>
      <div className="px-4 py-2.5 border-b border-line bg-surface2 font-mono text-[11.5px] text-faint">{label}</div>
      <pre className="p-4 overflow-x-auto font-mono text-[13px] leading-[1.7] text-ink/90">{children}</pre>
    </div>
  );
}
function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="card overflow-hidden overflow-x-auto my-2">
      <table className="w-full border-collapse text-[14px] min-w-[420px]">
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} className="text-left px-4 py-3 font-bold text-[13px] bg-surface2 border-b border-line">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((cell, j) => (
                <td key={j} className={`px-4 py-3 border-b border-line align-top ${j === 0 ? "text-ink font-medium font-mono text-[13px]" : "text-muted"}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-card p-4 text-[14px] text-muted leading-relaxed"
      style={{ background: "rgba(110,139,255,.07)", border: "1px solid rgba(110,139,255,.22)" }}>
      {children}
    </div>
  );
}