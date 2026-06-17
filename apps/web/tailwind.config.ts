import type { Config } from "tailwindcss";

/**
 * Keycat — "Eclipse" design tokens.
 * Cool, restrained near-black with a periwinkle accent.
 */
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: "#0A0A0F",
        surface: "#15151E",
        surface2: "#1C1C28",
        line: "#272734",
        line2: "#33333F",
        ink: "#F3F3F7",
        muted: "#9696A6",
        faint: "#62626E",
        accent: "#6E8BFF",
        "accent-bright": "#8AA0FF",
        "accent-tint": "#A6B6FF",
        "accent-deep": "#5570E0",
        ok: "#5CD0A8",
      },
      fontFamily: {
        display: ['"Space Grotesk"', "system-ui", "sans-serif"],
        sans: ['"Satoshi"', "system-ui", "-apple-system", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      borderRadius: {
        card: "20px",
        pill: "999px",
      },
      maxWidth: { site: "1180px" },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(20px)" },
          "100%": { opacity: "1", transform: "none" },
        },
        bob: {
          "0%,100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-8px)" },
        },
      },
      animation: {
        "fade-up": "fade-up .7s cubic-bezier(.22,.7,.27,1) both",
      },
    },
  },
  plugins: [],
} satisfies Config;