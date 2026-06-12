// Segmented -- carrier selector (internal / external) from portal.jsx.
// Two-option segmented control with an animated active indicator.
// Keyboard: arrow keys cycle between options (WAI-ARIA tablist pattern).
import { useCallback, useRef } from "react";

interface SegmentedProps {
  value: "internal" | "external";
  onChange: (value: "internal" | "external") => void;
  disabled?: boolean;
}

const opts: { v: "internal" | "external"; label: string }[] = [
  { v: "internal", label: "Internal carrier" },
  { v: "external", label: "External carrier" },
];

const segStyles = {
  root: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 0,
    padding: 4,
    background: "var(--surface-sunken)",
    borderRadius: "var(--radius-md)",
    border: "1px solid var(--border-subtle)",
  } as const,
  btn: {
    position: "relative" as const,
    height: 38,
    border: "none",
    background: "transparent",
    fontFamily: "var(--font-sans)",
    fontWeight: 600,
    fontSize: 13.5,
    letterSpacing: "-0.005em",
    borderRadius: 7,
    transition: "color 160ms var(--ease-standard)",
    outline: "none",
  },
  active: {
    position: "absolute" as const,
    inset: 0,
    background: "var(--idira-blue-500)",
    borderRadius: 7,
    boxShadow: "var(--shadow-brand)",
    zIndex: 0,
  },
};

export function Segmented({ value, onChange, disabled = false }: SegmentedProps) {
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Arrow keys cycle between the two tabs per WAI-ARIA tablist pattern.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (disabled) return;
      const idx = opts.findIndex((o) => o.v === value);
      let next = -1;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        next = (idx + 1) % opts.length;
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        next = (idx - 1 + opts.length) % opts.length;
      }
      const target = next >= 0 ? opts[next] : undefined;
      if (target) {
        e.preventDefault();
        onChange(target.v);
        btnRefs.current[next]?.focus();
      }
    },
    [value, onChange, disabled],
  );

  return (
    <div role="tablist" style={segStyles.root} onKeyDown={handleKeyDown}>
      {opts.map((o, i) => {
        const on = value === o.v;
        return (
          <button
            key={o.v}
            ref={(el) => { btnRefs.current[i] = el; }}
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(o.v)}
            style={{
              ...segStyles.btn,
              color: on ? "var(--neutral-0)" : "var(--text-muted)",
              cursor: disabled ? "not-allowed" : "pointer",
            }}
          >
            {on && <span style={segStyles.active} />}
            <span style={{ position: "relative", zIndex: 1 }}>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
