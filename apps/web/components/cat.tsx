import * as React from "react";

/**
 * Keycat mark. The cat the user picked: an accent tile with the cat silhouette
 * cut out in the base color and accent eyes. Scales cleanly to any size.
 *
 * `tone="solid"`  -> accent tile, base-colored cat (default, for the logo lockup)
 * `tone="ghost"`  -> transparent tile, accent-colored cat (for dark surfaces/avatars)
 */
export function CatMark({
  size = 34,
  tone = "solid",
  className,
}: {
  size?: number;
  tone?: "solid" | "ghost";
  className?: string;
}) {
  const tile = tone === "solid" ? "#6E8BFF" : "#15151E";
  const body = tone === "solid" ? "#0A0A0F" : "#6E8BFF";
  const eyes = tone === "solid" ? "#6E8BFF" : "#0A0A0F";
  const stroke = tone === "solid" ? "none" : "#33333F";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      className={className}
      aria-hidden="true"
    >
      <rect x="1" y="1" width="38" height="38" rx="11" fill={tile} stroke={stroke} />
      <path d="M11 16 13 8 20 14Z" fill={body} />
      <path d="M29 16 27 8 20 14Z" fill={body} />
      <rect x="9" y="13" width="22" height="19" rx="9.5" fill={body} />
      <circle cx="16" cy="22" r="1.8" fill={eyes} />
      <circle cx="24" cy="22" r="1.8" fill={eyes} />
    </svg>
  );
}

export function Wordmark({ size = 34 }: { size?: number }) {
  return (
    <span className="flex items-center gap-2.5 font-display text-[21px] font-semibold tracking-tight text-ink">
      <CatMark size={size} />
      Keycat
    </span>
  );
}