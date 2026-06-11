// Segmented -- carrier selector (internal / external) from portal.jsx.
// Two-option segmented control with an animated active indicator.

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
  return (
    <div role="tablist" style={segStyles.root}>
      {opts.map((o) => {
        const on = value === o.v;
        return (
          <button
            key={o.v}
            role="tab"
            aria-selected={on}
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
