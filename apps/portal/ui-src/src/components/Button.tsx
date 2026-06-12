// Button -- primary action primitive from the Idira design system.
// Variants: primary (solid blue), ghost (transparent), mono (dark-on-dark).
// Matches the _ds_bundle.js Button API surface used by portal.jsx.
import { type ReactNode, type ButtonHTMLAttributes, useRef } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "style"> {
  variant?: Variant;
  size?: Size;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  loading?: boolean;
  fullWidth?: boolean;
  style?: React.CSSProperties;
}

const SIZES: Record<Size, { height: number; padding: string; font: string; gap: number; icon: number }> = {
  sm: { height: 34, padding: "0 14px", font: "var(--fs-body-sm)", gap: 6, icon: 15 },
  md: { height: 42, padding: "0 18px", font: "var(--fs-body)",    gap: 8, icon: 17 },
  lg: { height: 50, padding: "0 24px", font: "var(--fs-body-lg)", gap: 10, icon: 19 },
};

const PALETTE: Record<Variant, Record<string, string>> = {
  primary:   { "--bg": "var(--idira-blue-500)", "--bg-hover": "var(--idira-blue-750)", "--fg": "var(--neutral-0)",            "--bd": "transparent",           "--shadow": "var(--shadow-sm)" },
  secondary: { "--bg": "var(--neutral-0)",      "--bg-hover": "var(--surface-brand-tint)", "--fg": "var(--idira-blue-750)", "--bd": "var(--border-default)", "--shadow": "var(--shadow-xs)" },
  ghost:     { "--bg": "transparent",           "--bg-hover": "var(--surface-brand-tint)", "--fg": "var(--idira-blue-750)", "--bd": "transparent",           "--shadow": "none" },
  danger:    { "--bg": "var(--status-danger)",   "--bg-hover": "#A8371C",                   "--fg": "var(--neutral-0)",     "--bd": "transparent",           "--shadow": "var(--shadow-sm)" },
};

function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ animation: "idira-spin 0.7s linear infinite" }}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" strokeOpacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export function Button({
  children,
  variant = "primary",
  size = "md",
  iconLeft = null,
  iconRight = null,
  disabled = false,
  loading = false,
  fullWidth = false,
  type = "button",
  onClick,
  style = {},
  ...rest
}: ButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const s = SIZES[size] ?? SIZES.md;
  const p = PALETTE[variant] ?? PALETTE.primary;

  const base: React.CSSProperties = {
    ...p as unknown as React.CSSProperties,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: s.gap,
    height: s.height,
    padding: s.padding,
    width: fullWidth ? "100%" : "auto",
    fontFamily: "var(--font-sans)",
    fontSize: s.font,
    fontWeight: "var(--fw-semibold)",
    letterSpacing: "var(--ls-snug)",
    color: "var(--fg)",
    background: "var(--bg)",
    border: "var(--border-width) solid var(--bd)",
    borderRadius: "var(--radius-md)",
    boxShadow: "var(--shadow)",
    cursor: disabled || loading ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    transition: "background var(--dur-fast) var(--ease-standard), transform var(--dur-fast) var(--ease-standard), box-shadow var(--dur-fast) var(--ease-standard)",
    whiteSpace: "nowrap",
    ...style,
  };

  const handleEnter = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (disabled || loading) return;
    e.currentTarget.style.background = "var(--bg-hover)";
    if (variant === "primary" || variant === "danger") {
      e.currentTarget.style.transform = "translateY(-1px)";
      e.currentTarget.style.boxShadow = "var(--shadow-md)";
    }
  };
  const handleLeave = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.background = "var(--bg)";
    e.currentTarget.style.transform = "none";
    e.currentTarget.style.boxShadow = "var(--shadow)";
  };
  const handleDown = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!disabled && !loading) e.currentTarget.style.transform = "translateY(0) scale(0.985)";
  };

  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      onClick={onClick}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onMouseDown={handleDown}
      onMouseUp={handleEnter}
      style={base}
      {...rest}
    >
      {loading && <Spinner size={s.icon} />}
      {!loading && iconLeft && <span style={{ display: "inline-flex", width: s.icon, height: s.icon }}>{iconLeft}</span>}
      {children}
      {!loading && iconRight && <span style={{ display: "inline-flex", width: s.icon, height: s.icon }}>{iconRight}</span>}
    </button>
  );
}
