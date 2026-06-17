"use client";

import * as React from "react";
import Link from "next/link";
import { CatMark, Wordmark } from "./cat";

export function Nav() {
  const [scrolled, setScrolled] = React.useState(false);
  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <nav
      className={`sticky top-0 z-50 backdrop-blur-md transition-colors duration-300 ${
        scrolled ? "bg-base/85 border-b border-line" : "bg-base/70 border-b border-transparent"
      }`}
    >
      <div className="mx-auto max-w-site px-6 h-[70px] flex items-center justify-between">
        <Link href="/" aria-label="Keycat home">
          <Wordmark />
        </Link>
        <div className="hidden md:flex items-center gap-8 text-[15px] font-medium text-muted">
          <a href="/#how" className="hover:text-ink transition-colors">How it works</a>
          <a href="/#recovery" className="hover:text-ink transition-colors">Recovery</a>
          <a href="/#trust" className="hover:text-ink transition-colors">Trust</a>
          <a href="/#developers" className="hover:text-ink transition-colors">Developers</a>
          <Link href="/docs" className="hover:text-ink transition-colors">Docs</Link>
        </div>
        <Link href="/app" className="btn-primary !py-2.5 text-[15px]">Launch app</Link>
      </div>
    </nav>
  );
}

export function Reveal({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [shown, setShown] = React.useState(false);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ease-[cubic-bezier(.22,.7,.27,1)] ${
        shown ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
      } ${className}`}
    >
      {children}
    </div>
  );
}

export function Faq({ items }: { items: { q: string; a: string }[] }) {
  const [open, setOpen] = React.useState<number | null>(null);
  return (
    <div className="max-w-[820px] mx-auto">
      {items.map((it, i) => (
        <div key={i} className="border-b border-line">
          <button
            onClick={() => setOpen(open === i ? null : i)}
            className="w-full text-left flex items-center justify-between gap-6 py-6 text-lg font-semibold tracking-tight text-ink"
            aria-expanded={open === i}
          >
            {it.q}
            <span
              className={`text-2xl text-accent transition-transform duration-200 ${
                open === i ? "rotate-45" : ""
              }`}
            >
              +
            </span>
          </button>
          <div
            className="overflow-hidden transition-all duration-300 ease-[cubic-bezier(.22,.7,.27,1)]"
            style={{ maxHeight: open === i ? 240 : 0 }}
          >
            <p className="text-muted text-base leading-relaxed pb-6 pr-10">{it.a}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-line py-14">
      <div className="mx-auto max-w-site px-6">
        <div className="grid grid-cols-2 md:grid-cols-[1.5fr_1fr_1fr_1fr] gap-8 mb-11">
          <div>
            <Wordmark />
            <p className="text-faint text-sm mt-4 max-w-[280px] leading-relaxed">
              The wallet that can&apos;t be lost. You hold the file, you hold the keys, you
              hold everything.
            </p>
          </div>
          <FootCol
            title="Product"
            links={[
              ["Launch app", "/app"],
              ["How it works", "/#how"],
              ["Recovery", "/#recovery"],
              ["Why it's safe", "/#trust"],
            ]}
          />
          <FootCol
            title="Developers"
            links={[
              ["Documentation", "/docs"],
              ["Quickstart", "/docs#quickstart"],
              ["SDK reference", "/docs#sdk"],
              ["Self-hosting", "/docs#self-hosting"],
            ]}
          />
          <FootCol
            title="Trust"
            links={[
              ["Security model", "/docs#security"],
              ["How recovery works", "/docs#recovery"],
              ["Keystore format", "/docs#keystore"],
            ]}
          />
        </div>
        <div className="flex flex-wrap justify-between gap-4 pt-7 border-t border-line">
          <p className="text-faint text-[13px]">© 2026 Keycat. You hold the keys.</p>
          <div className="flex flex-wrap gap-4 text-faint text-[13px] font-mono">
            <span>Built on MetaMask Smart Accounts</span>
            <span>ZK Email</span>
            <span>1Shot</span>
            <span>Venice</span>
          </div>
        </div>
      </div>
    </footer>
  );
}

function FootCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <h5 className="text-[13px] font-bold tracking-wide uppercase text-faint mb-4">
        {title}
      </h5>
      {links.map(([label, href]) => (
        <Link
          key={label}
          href={href}
          className="block text-muted text-[14.5px] mb-2.5 hover:text-ink transition-colors"
        >
          {label}
        </Link>
      ))}
    </div>
  );
}

export { CatMark };