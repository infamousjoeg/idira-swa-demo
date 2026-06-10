// Badge -- compact status pill with optional leading dot.
// Matches the _ds_bundle.js Badge API surface used by portal.jsx.
import type { ReactNode, HTMLAttributes } from "react";

type Tone = "success" | "warning" | "danger" | "info" | "brand" | "neutral";
type Variant = "soft" | "solid";

interface BadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, "style"> {
  children: ReactNode;
  tone?: Tone;
  variant?: Variant;
  dot?: boolean;
  size?: "sm" | "md";
  style?: React.CSSProperties;
}

const TONES: Record<Tone, { fg: string; bg: string; solid: string }> = {
  neutral: { fg: "var(--neutral-600)",       bg: "var(--neutral-100)",       solid: "var(--neutral-600)" },
  info:    { fg: "var(--idira-blue-750)",     bg: "var(--status-info-bg)",    solid: "var(--idira-blue-500)" },
  success: { fg: "var(--status-success)",     bg: "var(--status-success-bg)", solid: "var(--status-success)" },
  warning: { fg: "#8A6512",                   bg: "var(--status-warning-bg)", solid: "var(--status-warning)" },
  danger:  { fg: "var(--status-danger)",      bg: "var(--status-danger-bg)",  solid: "var(--status-danger)" },
  brand:   { fg: "var(--neutral-0)",          bg: "var(--idira-blue-500)",    solid: "var(--idira-blue-500)" },
};

const SIZES: Record<"sm" | "md", { f: string; p: string; dot: number }> = {
  sm: { f: "var(--fs-micro)",   p: "2px 8px",  dot: 6 },
  md: { f: "var(--fs-caption)", p: "3px 10px", dot: 7 },
};

export function Badge({
  children,
  tone = "neutral",
  variant = "soft",
  dot = false,
  size = "md",
  style = {},
  ...rest
}: BadgeProps) {
  const t = TONES[tone] ?? TONES.neutral;
  const s = SIZES[size] ?? SIZES.md;
  const isSolid = variant === "solid" || tone === "brand";

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: s.p,
        fontFamily: "var(--font-sans)",
        fontSize: s.f,
        fontWeight: "var(--fw-semibold)",
        lineHeight: 1.2,
        color: isSolid ? "var(--neutral-0)" : t.fg,
        background: isSolid ? t.solid : t.bg,
        borderRadius: "var(--radius-pill)",
        whiteSpace: "nowrap",
        ...style,
      }}
      {...rest}
    >
      {dot && (
        <span style={{
          width: s.dot,
          height: s.dot,
          borderRadius: "50%",
          background: isSolid ? "rgba(255,255,255,0.9)" : t.solid,
          flexShrink: 0,
        }} />
      )}
      {children}
    </span>
  );
}
