import Link from "next/link";
import { Nav, Footer, Reveal, Faq, CatMark } from "../components/chrome";

export default function LandingPage() {
  return (
    <>
      <Nav />

      {/* HERO */}
      <header className="relative overflow-hidden pt-20 pb-[70px]">
        <div className="pointer-events-none absolute -top-32 left-1/2 -translate-x-1/2 w-[900px] h-[560px] rounded-full opacity-70 blur-2xl"
          style={{ background: "radial-gradient(ellipse at center, rgba(110,139,255,.13), transparent 64%)" }} />
        <div className="relative mx-auto max-w-site px-6 grid lg:grid-cols-[1.04fr_.96fr] gap-12 items-center">
          <div>
            <span className="tag">A wallet you can&apos;t lose</span>
            <h1 className="font-display font-semibold tracking-[-.025em] leading-[.96] mt-5 mb-5 text-[clamp(46px,6.4vw,82px)]">
              Nine lives for your <span className="text-accent">crypto wallet.</span>
            </h1>
            <p className="text-muted text-[clamp(17px,1.5vw,19.5px)] max-w-[520px] mb-8">
              Keycat is a self-custody wallet that you genuinely can&apos;t lose. Your whole
              wallet is one secure file, and if it ever goes missing, you get it back with
              just your email. No seed phrase. No company holding your money.
            </p>
            <div className="flex flex-wrap gap-3 mb-7">
              <Link href="/app" className="btn-primary btn-lg">Create your wallet</Link>
              <a href="#how" className="btn-ghost btn-lg">See how it works</a>
            </div>
            <div className="flex flex-wrap gap-5 text-[13.5px] font-medium text-faint">
              {["No seed phrase", "Free to start", "Nothing to install"].map((t) => (
                <span key={t} className="inline-flex items-center gap-2">
                  <Check /> {t}
                </span>
              ))}
            </div>
          </div>
          <HeroWalletMock />
        </div>
      </header>

      {/* BENEFITS */}
      <Section>
        <Reveal>
          <SectionHead tag="Why people switch" title="A wallet that finally makes sense." />
        </Reveal>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {benefits.map((b) => (
            <Reveal key={b.title}>
              <div className="card p-6 h-full transition-all duration-300 hover:border-accent-deep hover:-translate-y-1">
                <div className="w-11 h-11 rounded-xl grid place-items-center text-accent mb-[18px]"
                  style={{ background: "rgba(110,139,255,.1)", border: "1px solid rgba(110,139,255,.24)" }}>
                  {b.icon}
                </div>
                <h3 className="text-lg font-bold tracking-tight mb-2">{b.title}</h3>
                <p className="text-[14.5px] text-muted leading-snug">{b.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* HOW */}
      <Section id="how">
        <Reveal>
          <SectionHead
            tag="How it works"
            title="From zero to wallet in under a minute."
            sub="No app store, no signup form, no waiting. Keycat never sees a thing."
          />
        </Reveal>
        <Reveal>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 card overflow-hidden">
            {steps.map((s, i) => (
              <div key={s.n} className={`p-7 ${i < steps.length - 1 ? "border-b lg:border-b-0 lg:border-r border-line" : ""}`}>
                <span className="font-mono text-[13px] text-accent font-bold">{s.n}</span>
                <h3 className="text-[19px] font-bold mt-3.5 mb-2">{s.title}</h3>
                <p className="text-[14.5px] text-muted leading-snug">{s.body}</p>
              </div>
            ))}
          </div>
        </Reveal>
      </Section>

      {/* RECOVERY */}
      <Section id="recovery">
        <div className="grid lg:grid-cols-[.85fr_1.15fr] gap-12 items-center">
          <Reveal>
            <span className="tag">The ninth life</span>
            <p className="font-display font-semibold tracking-[-.02em] leading-none mb-4 mt-5 text-[clamp(40px,5vw,64px)]">
              Lost it?<br />You&apos;ve got <span className="text-accent">nine lives.</span>
            </p>
            <p className="text-muted text-[17px]">
              Most wallets have one rule: lose your secret, lose everything. Keycat is built so
              that losing your file is a bad afternoon, not a disaster. Your email brings you
              back, and a built-in safety delay makes sure a thief can&apos;t use it against you.
            </p>
          </Reveal>
          <Reveal>
            <div className="card p-8">
              {recovery.map((r, i) => (
                <div key={r.n} className={`flex gap-4 py-4 ${i < recovery.length - 1 ? "border-b border-line" : ""}`}>
                  <span className="w-[30px] h-[30px] shrink-0 rounded-[9px] grid place-items-center text-accent font-mono text-[13px] font-bold"
                    style={{ background: "rgba(110,139,255,.12)", border: "1px solid rgba(110,139,255,.26)" }}>
                    {r.n}
                  </span>
                  <div>
                    <h4 className=" font-bold mb-1">{r.title}</h4>
                    <p className="text-[14px] text-muted leading-snug">{r.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </Section>

      {/* TRUST */}
      <Section id="trust">
        <Reveal>
          <SectionHead
            center
            tag="Why it's safe"
            title="The safest part is what we can't do."
            sub="There is no Keycat server holding your keys, because there is no Keycat server at all. So a whole category of disasters simply isn't ours to have."
          />
        </Reveal>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {cantdo.map((c) => (
            <Reveal key={c.title}>
              <div className="card p-6 h-full">
                <div className="w-8 h-8 rounded-[9px] grid place-items-center text-accent mb-[15px]"
                  style={{ background: "rgba(110,139,255,.1)", border: "1px solid rgba(110,139,255,.24)" }}>
                  <X />
                </div>
                <h4 className=" font-bold mb-1.5">{c.title}</h4>
                <p className="text-[14px] text-muted leading-snug">{c.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
        <p className="text-center text-faint text-[14.5px] mt-8">
          Curious how the encryption and recovery actually work under the hood?{" "}
          <Link href="/docs" className="text-accent font-semibold">Read the technical docs.</Link>
        </p>
      </Section>

      {/* COMPARE */}
      <Section>
        <Reveal>
          <SectionHead tag="Side by side" title="How Keycat stacks up." />
        </Reveal>
        <Reveal>
          <div className="card overflow-hidden overflow-x-auto">
            <table className="w-full border-collapse text-[15px] min-w-[560px]">
              <thead>
                <tr>
                  <th className="text-left p-[17px_20px] font-bold text-[14.5px] bg-surface2 border-b border-line">&nbsp;</th>
                  <th className="text-left p-[17px_20px] font-bold text-[14.5px] bg-surface2 border-b border-line text-accent">Keycat</th>
                  <th className="text-left p-[17px_20px] font-bold text-[14.5px] bg-surface2 border-b border-line">Typical wallet</th>
                  <th className="text-left p-[17px_20px] font-bold text-[14.5px] bg-surface2 border-b border-line">Exchange account</th>
                </tr>
              </thead>
              <tbody>
                {compare.map((row) => (
                  <tr key={row.label}>
                    <td className="p-[14px_20px] border-b border-line text-ink font-medium">{row.label}</td>
                    <Cell v={row.k} highlight />
                    <Cell v={row.b} />
                    <Cell v={row.e} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Reveal>
      </Section>

      {/* DEVELOPERS */}
      <Section id="developers">
        <div className="grid lg:grid-cols-2 gap-11 items-center">
          <Reveal>
            <span className="tag">For developers</span>
            <h2 className="font-display font-semibold tracking-[-.02em] leading-tight mb-4 mt-5 text-[clamp(28px,3.4vw,40px)]">
              Drop a real wallet into your app.
            </h2>
            <p className="text-muted text-[17px] mb-4">
              One script tag adds Keycat to any dApp as an embedded wallet. It shows up
              automatically in wagmi and RainbowKit, and your users get gasless, recoverable
              accounts without installing anything.
            </p>
            <Link href="/docs" className="btn-ghost btn-lg mt-1.5">Read the docs</Link>
          </Reveal>
          <Reveal>
            <div className="rounded-card overflow-hidden border border-line2" style={{ background: "#0E0E16" }}>
              <div className="px-4 py-3 border-b border-line bg-surface2 font-mono text-xs text-faint">index.html</div>
              <pre className="p-5 overflow-x-auto font-mono text-[13.5px] leading-[1.75]">
                <span className="text-faint">{"<script src="}</span>
                <span className="text-accent-tint">{'"https://cdn.keycat.net/widget.js"'}</span>
                <span className="text-faint">{"></script>"}</span>
                {"\n"}
                <span className="text-faint">{"<script>"}</span>
                {"\n  "}
                <span className="text-faint">const</span> wallet = <span className="text-faint">await</span>{" "}
                <span style={{ color: "#E8C06B" }}>KeycatVault</span>.init({"{ chainId: "}
                <span style={{ color: "#E8C06B" }}>8453</span>
                {" });\n  "}
                <span className="text-faint">const</span> [account] = <span className="text-faint">await</span> wallet.request({"{"}
                {"\n    method: "}
                <span className="text-accent-tint">{"'eth_requestAccounts'"}</span>
                {"\n  });\n"}
                <span className="text-faint">{"</script>"}</span>
              </pre>
            </div>
          </Reveal>
        </div>
      </Section>

      {/* FAQ */}
      <Section>
        <Reveal>
          <SectionHead center tag="Good questions" title="The fine print, up front." />
        </Reveal>
        <Reveal>
          <Faq items={faq} />
        </Reveal>
      </Section>

      {/* CTA */}
      <section className="text-center py-24 border-t border-line">
        <div className="mx-auto max-w-site px-6">
          <Reveal>
            <h2 className="font-display font-semibold tracking-[-.025em] leading-none mb-4 text-[clamp(34px,4.6vw,58px)]">
              Give your wallet<br />nine lives.
            </h2>
          </Reveal>
          <Reveal>
            <p className="text-muted text-[19px] max-w-[520px] mx-auto mb-7">
              Create one in your browser in under a minute. Free, no signup, no seed phrase.
            </p>
          </Reveal>
          <Reveal>
            <div className="flex flex-wrap gap-3 justify-center">
              <Link href="/app" className="btn-primary btn-lg">Create your wallet</Link>
              <Link href="/docs" className="btn-ghost btn-lg">Read the docs</Link>
            </div>
          </Reveal>
        </div>
      </section>

      <Footer />
    </>
  );
}

/* ---------- layout helpers ---------- */
function Section({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="py-[88px] border-t border-line">
      <div className="mx-auto max-w-site px-6">{children}</div>
    </section>
  );
}
function SectionHead({ tag, title, sub, center }: { tag: string; title: string; sub?: string; center?: boolean }) {
  return (
    <div className={`max-w-[660px] mb-12 ${center ? "mx-auto text-center" : ""}`}>
      <span className="tag">{tag}</span>
      <h2 className="font-display font-semibold tracking-[-.02em] leading-[1.06] mt-4 mb-3.5 text-[clamp(30px,3.7vw,46px)]">
        {title}
      </h2>
      {sub && <p className="text-muted text-lg">{sub}</p>}
    </div>
  );
}
function Cell({ v, highlight }: { v: string; highlight?: boolean }) {
  const yes = v === "Yes";
  return (
    <td className={`p-[14px_20px] border-b border-line ${highlight ? "bg-accent/[.06]" : ""}`}>
      <span className={yes ? "text-accent font-bold" : "text-faint"}>{v}</span>
    </td>
  );
}

/* ---------- hero product mock ---------- */
function HeroWalletMock() {
  return (
    <div className="relative flex items-center justify-center min-h-[360px]">
      <div className="w-full max-w-[380px] rounded-card p-5 border border-line"
        style={{ background: "linear-gradient(180deg,#15151E,#101019)", boxShadow: "0 30px 60px -30px rgba(0,0,0,.7)" }}>
        <div className="flex items-center gap-3 mb-[18px]">
          <div className="w-[38px] h-[38px] rounded-xl grid place-items-center bg-accent">
            <CatMark size={26} />
          </div>
          <div>
            <div className="text-xs text-muted">Smart account</div>
            <div className="font-mono text-[12.5px] font-medium text-ink">0x7a3f…9C21</div>
          </div>
          <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] font-bold text-accent-tint rounded-pill px-2.5 py-1"
            style={{ background: "rgba(110,139,255,.1)", border: "1px solid rgba(110,139,255,.24)" }}>
            <span className="w-1.5 h-1.5 rounded-full bg-ok" /> Recovery on
          </span>
        </div>
        <div className="text-[13px] text-muted">Total balance</div>
        <div className="text-[34px] font-extrabold tracking-tight mb-[18px]">$4,120.65</div>
        {[
          { c: "Ξ", n: "Ethereum", a: "1.204", bg: "#6E8BFF", fg: "#0A0A0F" },
          { c: "$", n: "USDC", a: "1,200.00", bg: "#2775CA", fg: "#fff" },
        ].map((t) => (
          <div key={t.n} className="flex items-center gap-3 py-3 border-t border-line">
            <span className="w-[30px] h-[30px] rounded-full grid place-items-center font-bold text-[13px]"
              style={{ background: t.bg, color: t.fg }}>{t.c}</span>
            <span className="text-[14px] font-semibold">{t.n}</span>
            <span className="ml-auto font-mono text-[13px] text-muted">{t.a}</span>
          </div>
        ))}
        <div className="mt-4 grid grid-cols-2 gap-2.5">
          <div className="btn-primary !py-2.5 text-[14px]">Send</div>
          <div className="btn-ghost !py-2.5 text-[14px]">Receive</div>
        </div>
      </div>
    </div>
  );
}

/* ---------- icons ---------- */
function Check() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" className="text-accent">
      <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function X() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}
function I({ d }: { d: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path d={d} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ---------- content ---------- */
const benefits = [
  { title: "No seed phrase", body: "Forget writing down twelve random words and praying you never lose them. Your wallet is just one file you keep like any other.", icon: <I d="M4 7h16M4 12h16M4 17h10" /> },
  { title: "Get it back with email", body: "Lose your file or your phone? Prove it's really you with your email and you are back in. That is the ninth life.", icon: <I d="M3 6h18v13H3zM3.5 7l8.5 6 8.5-6" /> },
  { title: "Nobody can touch it", body: "Not us, not a hacker who breaks into our website, nobody. Only you can ever move your money.", icon: <I d="M12 3l7 3v6c0 5-3 7-7 9-4-2-7-4-7-9V6l7-3z" /> },
  { title: "No gas, no hassle", body: "Send and swap without buying ETH first. The network fees are handled for you, so you can just use it.", icon: <I d="M13 2L4.5 13H11l-1 9 9-11h-6.5L13 2z" /> },
];

const steps = [
  { n: "01", title: "Pick a password", body: "Optionally add your fingerprint or face. Keycat builds your wallet right in your browser." },
  { n: "02", title: "Save your file", body: "You get one secure file. That is your wallet. Keep a copy somewhere safe, like you would a photo." },
  { n: "03", title: "Turn on recovery", body: "Add your email so future-you can always get back in, even if the file is gone." },
  { n: "04", title: "Start using it", body: "Send, receive, and connect to apps. Everything just works, with fees handled for you." },
];

const recovery = [
  { n: "1", title: "Email a recovery request", body: "Send it from the inbox you set up. Your email provider quietly vouches that it's really you." },
  { n: "2", title: "It's checked, privately", body: "Your identity is verified by math, on-chain. Your email address is never made public." },
  { n: "3", title: "A short safety window", body: "A waiting period opens. If this wasn't you, your old wallet can cancel it on the spot." },
  { n: "4", title: "You're back in", body: "Your wallet moves to a fresh file. Same account, same balance, brand new key." },
];

const cantdo = [
  { title: "We can't take your money", body: "We never hold your key or any piece of it. There is no button on our end that moves your funds." },
  { title: "We can't see your file", body: "It's locked on your device and never sent to us. Your password never leaves your browser." },
  { title: "We can't freeze you", body: "There's no middleman to block or pause your transactions. Your wallet answers only to you." },
  { title: "We can't track you", body: "No accounts, no analytics, no logs sitting on a server. There's nothing to gather." },
  { title: "A breach can't drain you", body: "Even if our site were hacked, there's no vault of customer keys to steal, because we never had one." },
  { title: "We can't recover for you", body: "Recovery is yours alone, tied to your email and a safety delay we don't control. That's the point." },
];

const compare = [
  { label: "You own your money", k: "Yes", b: "Yes", e: "No" },
  { label: "No seed phrase to lose", k: "Yes", b: "No", e: "Yes" },
  { label: "Recover with your email", k: "Yes", b: "No", e: "Yes" },
  { label: "Nobody can freeze it", k: "Yes", b: "Yes", e: "No" },
  { label: "No fees to get started", k: "Yes", b: "Often", e: "Yes" },
  { label: "Tells you what you're signing", k: "Yes", b: "Rarely", e: "N/A" },
];

const faq = [
  { q: "What exactly is \u201cthe file\u201d?", a: "It's a small encrypted file that holds your wallet, locked with your password. You download it when you create your wallet and keep a copy somewhere safe. Anyone who finds it sees only scrambled data, useless without your password." },
  { q: "What if I lose the file?", a: "If you turned on email recovery, you prove it's you with your email and your wallet comes back on a fresh file. If you skipped recovery and kept no copy, the wallet can't be restored, the same as any wallet you don't back up." },
  { q: "Is my email kept private?", a: "Yes. Keycat never stores it, and it never appears publicly on the blockchain. During a recovery it's checked by math, not handed to us." },
  { q: "What if I lose my email too?", a: "Then the wallet can't be recovered. Your email is the anchor, just like a password reset on any website. We say this plainly instead of pretending there's a backdoor, because a backdoor for us would be a backdoor for attackers." },
  { q: "Who pays the network fees?", a: "You do, but in stablecoins and in tiny amounts, with no ETH needed. Transactions are relayed for you, so you never have to top up gas just to move." },
  { q: "Can Keycat freeze or take my funds?", a: "No. There's no custody and no server that can sign for you. Your account answers only to you and to a recovery you control." },
  { q: "Do I need to install anything?", a: "No. Keycat runs in your browser. There's no extension or app to download, and nothing to update." },
  { q: "What if keycat.net goes away?", a: "Your wallet doesn't depend on us. The app can be self-hosted, the contracts live on-chain forever, and your file is yours. You're never locked to our website." },
];