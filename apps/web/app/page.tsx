export default function Page() {
  return (
    <main
      style={{
        alignItems: "center",
        background: "#f6f3ee",
        color: "#182322",
        display: "grid",
        fontFamily:
          'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        minHeight: "100vh",
        padding: "40px 20px"
      }}
    >
      <section style={{ maxWidth: 760 }}>
        <p style={{ color: "#1f8a6b", fontWeight: 800, margin: "0 0 12px" }}>
          Keycat
        </p>
        <h1 style={{ fontSize: "clamp(2.4rem, 8vw, 5.5rem)", lineHeight: 1, margin: 0 }}>
          Zero-storage keystore wallet.
        </h1>
        <p style={{ color: "#56615b", fontSize: "1.1rem", maxWidth: 560 }}>
          Bring one encrypted wallet file to dApps that embed Keycat, or use the
          standalone wallet when they do not.
        </p>
        <a
          href="/app"
          style={{
            background: "#1f8a6b",
            borderRadius: 8,
            color: "white",
            display: "inline-block",
            fontWeight: 800,
            marginTop: 16,
            padding: "12px 16px",
            textDecoration: "none"
          }}
        >
          Open wallet
        </a>
      </section>
    </main>
  );
}
