// Tag -- labelled chip with square corners (vs Badge's pill).
// Matches the _ds_bundle.js Tag API surface used by portal.jsx.
import type { ReactNode, HTMLAttributes } from "react";

type Tone = "success" | "warning" | "danger" | "info" | "brand" | "neutral";

interface TagProps extends Omit<HTMLAttributes<HTMLSpanElement>, "style"> {
  children: ReactNode;
  tone?: Tone;
  onRemove?: () => void;
  iconLeft?: ReactNode;
  style?: React.CSSProperties;
}

const TONES: Record<Tone, { fg: string; bg: string; bd: string }> = {
  neutral: { fg: "var(--neutral-700)",      bg: "var(--neutral-100)",       bd: "var(--border-default)" },
  brand:   { fg: "var(--idira-blue-750)",   bg: "var(--surface-brand-tint)", bd: "var(--idira-blue-0)" },
  success: { fg: "var(--status-success)",   bg: "var(--status-success-bg)", bd: "var(--status-success)" },
  warning: { fg: "#8A6512",                 bg: "var(--status-warning-bg)", bd: "var(--status-warning)" },
  danger:  { fg: "var(--status-danger)",    bg: "var(--status-danger-bg)",  bd: "var(--status-danger)" },
  info:    { fg: "var(--idira-blue-750)",   bg: "var(--status-info-bg)",    bd: "var(--idira-blue-0)" },
};

export function Tag({
  children,
  tone = "neutral",
  onRemove,
  iconLeft = null,
  style = {},
  ...rest
}: TagProps) {
  const t = TONES[tone] ?? TONES.neutral;

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: onRemove ? "4px 6px 4px 10px" : "4px 10px",
        fontFamily: "var(--font-sans)",
        fontSize: "var(--fs-body-sm)",
        fontWeight: "var(--fw-medium)",
        color: t.fg,
        background: t.bg,
        border: `var(--border-width) solid ${t.bd}`,
        borderRadius: "var(--radius-sm)",
        ...style,
      }}
      {...rest}
    >
      {iconLeft && <span style={{ display: "inline-flex", width: 14, height: 14 }}>{iconLeft}</span>}
      {children}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 18,
            height: 18,
            padding: 0,
            border: "none",
            cursor: "pointer",
            borderRadius: "var(--radius-xs)",
            background: "transparent",
            color: "currentColor",
            opacity: 0.6,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.6"; }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      )}
    </span>
  );
}
