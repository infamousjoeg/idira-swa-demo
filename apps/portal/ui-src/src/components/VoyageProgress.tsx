// VoyageProgress -- 3-node tracking strip (Loaded -> In transit -> Arrived).
// Mirrors the dominant pattern in real freight tracking surfaces (Maersk
// MyShipment, Flexport tracking). Static-demo: current node is hardcoded
// to "transit" since the demo shipment is always mid-flight.
import { Package, Ship, Anchor } from "lucide-react";

type NodeKey = "loaded" | "transit" | "arrived";

interface VoyageNode {
  key: NodeKey;
  label: string;
  icon: typeof Package;
  sub: string;
}

const NODES: VoyageNode[] = [
  { key: "loaded", label: "Loaded", icon: Package, sub: "Singapore PSA Terminal 4" },
  { key: "transit", label: "In transit", icon: Ship, sub: "East China Sea" },
  { key: "arrived", label: "Arrived", icon: Anchor, sub: "Long Beach (est)" },
];

const BRAND = "#265BFF";
const LINE = "var(--border-default)";

export function VoyageProgress({
  current = "transit" as NodeKey,
}: { current?: NodeKey } = {}) {
  const currentIdx = NODES.findIndex((n) => n.key === current);

  return (
    <div style={vp.root}>
      <div style={vp.track}>
        {NODES.map((node, i) => {
          const state: "done" | "active" | "pending" =
            i < currentIdx ? "done" : i === currentIdx ? "active" : "pending";
          const Icon = node.icon;
          return (
            <div key={node.key} style={vp.col}>
              {/* connector segment to the LEFT of this node (skipped for index 0) */}
              {i > 0 && (
                <div
                  style={{
                    ...vp.connector,
                    background: i <= currentIdx ? BRAND : LINE,
                  }}
                />
              )}
              <div style={vp.nodeWrap}>
                <div
                  style={{
                    ...vp.dot,
                    background: state === "pending" ? "#fff" : BRAND,
                    borderColor: state === "pending" ? LINE : BRAND,
                    color: state === "pending" ? "var(--text-subtle)" : "#fff",
                    boxShadow:
                      state === "active"
                        ? "0 0 0 3px rgba(38,91,255,0.18)"
                        : "none",
                  }}
                  aria-label={`${node.label}: ${state}`}
                >
                  <Icon size={14} strokeWidth={2} />
                </div>
                <div style={vp.labelCol}>
                  <span
                    style={{
                      ...vp.label,
                      color:
                        state === "pending"
                          ? "var(--text-subtle)"
                          : "var(--text-strong)",
                      fontWeight: state === "active" ? 700 : 600,
                    }}
                  >
                    {node.label}
                  </span>
                  <span style={vp.sub}>{node.sub}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const vp = {
  root: { paddingTop: 4 },
  track: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 0,
  },
  col: {
    flex: 1,
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "flex-start" as const,
    position: "relative" as const,
  },
  connector: {
    position: "absolute" as const,
    top: 13,
    left: "-50%",
    width: "100%",
    height: 2,
    zIndex: 0,
  },
  nodeWrap: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "flex-start" as const,
    position: "relative" as const,
    zIndex: 1,
  },
  dot: {
    width: 28,
    height: 28,
    borderRadius: 999,
    border: "2px solid",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    transition: "all 160ms var(--ease-standard)",
  },
  labelCol: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 2,
    marginTop: 8,
  },
  label: {
    fontSize: 12.5,
    letterSpacing: "0.005em",
    lineHeight: 1.2,
  },
  sub: {
    fontSize: 11,
    color: "var(--text-subtle)",
    lineHeight: 1.3,
    fontFamily: "var(--font-mono)",
  },
};
