// DarkSeg -- compact dark segmented control for the inspector chrome.
// Ported from app.jsx's DarkSeg helper. Used for view and pace controls.
// NO Tweaks panel -- production drops it per spec section 3.
import type { ReactNode } from "react";

interface DarkSegOption<T extends string> {
  v: T;
  label: string;
  title?: string;
  icon?: ReactNode;
}

interface DarkSegProps<T extends string> {
  value: T;
  onChange: (v: T) => void;
  options: DarkSegOption<T>[];
  label?: string;
}

const ds = {
  group: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  } as const,
  label: {
    fontFamily: "var(--font-mono)",
    fontSize: 9.5,
    letterSpacing: "0.12em",
    textTransform: "uppercase" as const,
    color: "rgba(173,192,252,0.45)",
    fontWeight: 600,
  },
  track: {
    display: "flex",
    gap: 2,
    padding: 3,
    background: "rgba(6,18,55,0.6)",
    border: "1px solid rgba(97,134,252,0.2)",
    borderRadius: 9,
  } as const,
  btn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    border: "none",
    borderRadius: 6,
    cursor: "pointer",
    fontFamily: "var(--font-sans)",
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: "0.01em",
    padding: "5px 11px",
    transition: "all 160ms var(--ease-standard)",
  } as const,
};

export function DarkSeg<T extends string>({
  value,
  onChange,
  options,
  label,
}: DarkSegProps<T>) {
  return (
    <div style={ds.group}>
      {label != null && <span style={ds.label}>{label}</span>}
      <div style={ds.track}>
        {options.map((o) => {
          const on = value === o.v;
          return (
            <button
              key={o.v}
              onClick={() => onChange(o.v)}
              title={o.title ?? o.label}
              style={{
                ...ds.btn,
                color: on ? "#fff" : "rgba(196,210,250,0.6)",
                background: on ? "var(--idira-blue-500)" : "transparent",
                boxShadow: on
                  ? "0 2px 10px rgba(38,91,255,0.45)"
                  : "none",
              }}
            >
              {o.icon}
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
