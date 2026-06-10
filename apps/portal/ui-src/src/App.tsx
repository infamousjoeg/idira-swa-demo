// App -- M-UI1 "Hello, Idira" landing that proves the toolchain, tokens,
// design system components, and brand assets are all wired correctly.
// This will be replaced by the full portal+inspector layout in M-UI2/M-UI3.
import { useState } from "react";
import { Button } from "./components/Button";
import { Input } from "./components/Input";
import { Badge } from "./components/Badge";
import { Tag } from "./components/Tag";
import { PackageSearch, KeyRound, ShieldCheck } from "lucide-react";

export function App() {
  const [shipmentId, setShipmentId] = useState("SHP-2049-883");

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      minHeight: "100vh",
      background: "var(--surface-page)",
    }}>
      {/* App bar */}
      <header style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "16px 36px",
        borderBottom: "1px solid var(--border-subtle)",
        background: "var(--surface-card)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
          <img src="/assets/idira-icon-color.png" alt="" style={{ height: 24, width: "auto" }} />
          <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.05 }}>
            <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15, color: "var(--text-strong)", letterSpacing: "-0.01em" }}>
              Hello, Idira
            </span>
            <span style={{ fontSize: 11, color: "var(--text-muted)", letterSpacing: "0.01em" }}>
              Design system foundation
            </span>
          </div>
        </div>
        <div style={{
          display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, fontWeight: 600,
          color: "var(--text-muted)", letterSpacing: "0.02em",
          padding: "6px 11px 6px 9px", border: "1px solid var(--border-subtle)", borderRadius: 999,
        }}>
          <img src="/assets/idira-icon-color.png" alt="" style={{ height: 16, width: "auto" }} />
          <span>Secured by Idira</span>
        </div>
      </header>

      {/* Component showcase */}
      <main style={{ flex: 1, padding: "40px 36px", maxWidth: 640 }}>
        <h1 style={{ fontSize: "clamp(2rem, 1.2rem + 2vw, 2.9rem)", margin: "0 0 12px", letterSpacing: "-0.025em", lineHeight: 1.02 }}>
          Design system tokens loaded.
        </h1>
        <p style={{ fontSize: 15, lineHeight: 1.55, color: "var(--text-muted)", maxWidth: 440, margin: "0 0 28px" }}>
          TT Hoves Pro is the display font. IBM Plex Mono is the mono font.
          All four design system components render below with real token values.
        </p>

        {/* Input */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 28 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <label className="idira-eyebrow" style={{ color: "var(--text-muted)" }}>Shipment ID</label>
            <Input
              value={shipmentId}
              onChange={(e) => setShipmentId(e.target.value)}
              iconLeft={<PackageSearch size={18} />}
            />
          </div>

          {/* Button */}
          <Button size="lg" fullWidth iconLeft={<KeyRound size={19} />}>
            Resolve secret
          </Button>
        </div>

        {/* Badge + Tag */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 28 }}>
          <Badge tone="success" dot>In transit</Badge>
          <Badge tone="brand">Verified</Badge>
          <Badge tone="danger">Rejected</Badge>
          <Badge tone="warning">Pending</Badge>
          <Badge tone="info">Active</Badge>
          <Badge tone="neutral">Default</Badge>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 28 }}>
          <Tag tone="brand">mTLS verified</Tag>
          <Tag tone="neutral">k8s_psat</Tag>
          <Tag tone="danger">Untrusted CA</Tag>
        </div>

        {/* Trust evidence (mono font check) */}
        <div style={{
          display: "flex", flexDirection: "column", gap: 13, padding: "16px 18px",
          borderRadius: "var(--radius-lg)", borderLeft: "3px solid var(--brand)",
          border: "1px solid var(--brand)", background: "var(--surface-brand-tint)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--brand)" }}>
            <ShieldCheck size={15} />
            <span className="idira-eyebrow" style={{ color: "var(--brand)" }}>Trust evidence</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <strong style={{ fontSize: 13, color: "var(--text-strong)", fontWeight: 700 }}>
              Cryptographic identity, not a key.
            </strong>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5 }}>
              spiffe://idira.demo/kind-ng/ns/swa-demo/sa/carrier
            </span>
          </div>
        </div>
      </main>
    </div>
  );
}
