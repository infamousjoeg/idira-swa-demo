// PortalPane -- left pane of the SWA demo. Praetor Logistics shipment portal.
// Reads the resolve engine state and renders idle / running / done / error.
// Manifest fields come from the real carrier response, not SWA.shipment constants.
import {
  PackageSearch,
  KeyRound,
  Info,
  ScanSearch,
  XOctagon,
} from "lucide-react";
import { Button } from "./Button";
import { Input } from "./Input";
import { Badge } from "./Badge";
import { Tag } from "./Tag";
import { PraetorMark } from "./PraetorMark";
import { Segmented } from "./Segmented";
import { RouteStrip } from "./RouteStrip";
import { Evidence } from "./Evidence";
import type { EngineStatus, ResolveResult, ResolveError } from "../engine/useResolveEngine";

/** "2026-06-09T14:00:00Z" -> "Jun 9, 14:00 UTC" */
function formatEtaShort(raw: string): string {
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  const mon = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const day = d.getUTCDate();
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${mon} ${day}, ${hh}:${mm} UTC`;
}

interface PortalPaneProps {
  carrier: "internal" | "external";
  setCarrier: (v: "internal" | "external") => void;
  status: EngineStatus;
  stageVerb: string;
  shipmentId: string;
  setShipmentId: (v: string) => void;
  onResolve: () => void;
  result: ResolveResult | null;
  error: ResolveError | null;
}

const ps = {
  pane: {
    display: "flex",
    flexDirection: "column" as const,
    height: "100%",
    background: "var(--surface-card)",
    overflow: "hidden",
  },
  appbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "16px 36px",
    borderBottom: "1px solid var(--border-subtle)",
    flexShrink: 0,
  },
  brand: { display: "flex", alignItems: "center", gap: 11 },
  brandName: {
    fontFamily: "var(--font-display)",
    fontWeight: 700,
    fontSize: 15,
    color: "var(--text-strong)",
    letterSpacing: "-0.01em",
  },
  brandSub: { fontSize: 11, color: "var(--text-muted)", letterSpacing: "0.01em" },
  secured: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    fontSize: 11.5,
    fontWeight: 600,
    color: "var(--text-muted)",
    letterSpacing: "0.02em",
    padding: "6px 11px 6px 9px",
    border: "1px solid var(--border-subtle)",
    borderRadius: 999,
  },
  body: {
    flex: 1,
    overflowY: "auto" as const,
    padding: "40px 36px 48px",
    display: "flex",
    flexDirection: "column" as const,
    gap: 28,
  },
  hero: { display: "flex", flexDirection: "column" as const, gap: 12, maxWidth: 460 },
  h1: {
    fontSize: "clamp(2rem, 1.2rem + 2vw, 2.9rem)",
    margin: 0,
    color: "var(--text-strong)",
    letterSpacing: "-0.025em",
    lineHeight: 1.02,
  },
  lede: {
    margin: 0,
    fontSize: 15,
    lineHeight: 1.55,
    color: "var(--text-muted)",
    maxWidth: 440,
  },
  form: { display: "flex", flexDirection: "column" as const, gap: 16, maxWidth: 460 },
  field: { display: "flex", flexDirection: "column" as const, gap: 8 },
  label: { color: "var(--text-muted)" },
  formHint: {
    display: "flex",
    gap: 7,
    fontSize: 12.5,
    color: "var(--text-subtle)",
    lineHeight: 1.45,
    marginTop: -2,
  },
  result: { minHeight: 60, maxWidth: 460 },
  empty: {
    display: "flex",
    alignItems: "center",
    gap: 11,
    padding: "22px 0",
    borderTop: "1px solid var(--border-subtle)",
    color: "var(--text-subtle)",
    fontSize: 13.5,
  },
  workingDot: {
    width: 9,
    height: 9,
    borderRadius: 999,
    background: "var(--brand)",
    flexShrink: 0,
    boxShadow: "0 0 0 0 rgba(38,91,255,0.5)",
    animation: "praetorPulse 1.1s var(--ease-standard) infinite",
  },
  resultIn: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 20,
    paddingTop: 24,
    borderTop: "1px solid var(--border-subtle)",
    animation: "praetorRise 420ms var(--ease-emphasis) both",
  },
  mfHead: { display: "flex", alignItems: "flex-start", justifyContent: "space-between" },
  mfId: {
    fontFamily: "var(--font-mono)",
    fontSize: 22,
    fontWeight: 600,
    color: "var(--text-strong)",
    letterSpacing: "-0.01em",
    marginTop: 2,
  },
  manifest: { display: "flex", flexDirection: "column" as const },
  mfRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    padding: "11px 0",
    borderBottom: "1px solid var(--border-subtle)",
  },
  mfKey: { fontSize: 12.5, color: "var(--text-muted)", letterSpacing: "0.01em" },
  mfVal: { fontSize: 14, fontWeight: 600, color: "var(--text-body)" },
  errAccent: {
    borderLeft: "3px solid var(--status-danger)",
    paddingLeft: 12,
  },
  errBar: { display: "flex", alignItems: "center", justifyContent: "space-between" },
  errCode: {
    display: "flex",
    alignItems: "center",
    gap: 9,
    color: "var(--status-danger)",
    fontFamily: "var(--font-mono)",
    fontSize: 16,
    fontWeight: 600,
  },
  errMsg: { margin: 0, fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.55 },
  errUriChip: {
    border: "1px solid #FF7A57",
    borderRadius: 8,
    padding: "8px 12px",
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    color: "var(--text-muted)",
    wordBreak: "break-all" as const,
  },
};

function ManifestRow({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div style={ps.mfRow}>
      <span style={ps.mfKey}>{k}</span>
      <span
        style={{
          ...ps.mfVal,
          fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)",
        }}
      >
        {v}
      </span>
    </div>
  );
}

export function PortalPane({
  carrier,
  setCarrier,
  status,
  stageVerb,
  shipmentId,
  setShipmentId,
  onResolve,
  result,
  error,
}: PortalPaneProps) {
  const busy = status === "running";
  const done = status === "done";
  const isError = status === "error";

  // Manifest values come from the real carrier response when available.
  const r = result;

  return (
    <div style={ps.pane}>
      {/* app chrome */}
      <header style={ps.appbar}>
        <div style={ps.brand}>
          <div
            style={{
              display: "inline-flex",
              animation:
                done
                  ? "praetorHit 240ms cubic-bezier(0.16, 1, 0.3, 1) both"
                  : "none",
            }}
          >
            <PraetorMark />
          </div>
          <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.05 }}>
            <span style={ps.brandName}>Praetor Logistics</span>
            <span style={ps.brandSub}>Shipment operations</span>
          </div>
        </div>
        <div style={ps.secured}>
          <img src="/assets/idira-icon-color.png" alt="" style={{ height: 16, width: "auto" }} />
          <span>Secured by Idira</span>
        </div>
      </header>

      <div style={ps.body}>
        <div style={ps.hero}>
          <h1 style={ps.h1}>Look up a shipment.</h1>
          <p style={ps.lede}>
            The portal resolves a shipment through a carrier service that fetches its API
            credential at request time -- a credential this workload never stores.
          </p>
        </div>

        {/* lookup form */}
        <div style={ps.form}>
          <div style={ps.field}>
            <label className="idira-eyebrow" style={ps.label}>
              Shipment ID
            </label>
            <Input
              value={shipmentId}
              onChange={(e) => setShipmentId(e.target.value)}
              disabled={busy}
              iconLeft={<PackageSearch size={18} />}
            />
          </div>
          <div style={ps.field}>
            <label className="idira-eyebrow" style={ps.label}>
              Carrier
            </label>
            <Segmented value={carrier} onChange={setCarrier} disabled={busy} />
          </div>
          <Button size="lg" fullWidth onClick={onResolve} loading={busy} iconLeft={!busy ? <KeyRound size={19} /> : undefined}>
            {busy ? stageVerb || "Resolving..." : done || isError ? "Resolve again" : "Resolve secret"}
          </Button>
          <div style={ps.formHint}>
            <Info size={13} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>Watch the identity exchange unfold in the Idira Inspector on the right.</span>
          </div>
        </div>

        {/* result region */}
        <div style={ps.result}>
          {status === "idle" && (
            <div style={ps.empty}>
              <ScanSearch size={22} style={{ opacity: 0.5 }} />
              <span>Resolve to retrieve the manifest and watch the credential exchange.</span>
            </div>
          )}

          {busy && (
            <div style={ps.empty}>
              <span style={ps.workingDot} />
              <span>{stageVerb || "Working"} -- holding no credential on this workload...</span>
            </div>
          )}

          {done && r && (
            <div style={ps.resultIn}>
              <div style={ps.mfHead}>
                <div>
                  <span className="idira-eyebrow" style={{ color: "var(--text-muted)" }}>
                    Shipment
                  </span>
                  <div style={ps.mfId}>{r.shipment_id ?? shipmentId}</div>
                </div>
                <Badge tone="success" dot>
                  In transit
                </Badge>
              </div>
              <RouteStrip
                origin={r.origin ?? ""}
                dest={r.destination ?? ""}
                eta={r.eta ?? ""}
              />
              <div style={ps.manifest}>
                {r.carrier_name && <ManifestRow k="Carrier" v={r.carrier_name} />}
                {r.mode && <ManifestRow k="Mode" v={r.mode} />}
                {r.container && <ManifestRow k="Container" v={r.container} mono />}
                {r.weight && <ManifestRow k="Gross weight" v={r.weight} />}
                {r.eta && <ManifestRow k="ETA" v={formatEtaShort(r.eta)} />}
              </div>
              <Evidence kind="success" />
            </div>
          )}

          {isError && (
            <div style={ps.resultIn}>
              <div style={ps.errAccent}>
                <div style={ps.errBar}>
                  <div style={ps.errCode}>
                    <XOctagon size={18} />
                    <span>502 -- resolve failed</span>
                  </div>
                  <Tag tone="brand">mTLS rejected</Tag>
                </div>
              </div>
              <p style={ps.errMsg}>
                {error?.message
                  ? error.message
                  : "The external carrier could not be authenticated. No secret was issued, so the shipment manifest cannot be returned."}
              </p>
              {error?.payload?.uri != null && (
                <div style={ps.errUriChip}>
                  {String(error.payload.uri)}
                </div>
              )}
              <Evidence kind="error" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
