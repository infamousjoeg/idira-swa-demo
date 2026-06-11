// InspectorChrome -- shared chrome for the inspector right pane.
// Header lockup with Idira icon, view/pace controls via DarkSeg,
// trust-context bar with four cells from SWA.trust, status footer
// with phase indicator + Reset, background texture per the corrected
// bgLayers rules (contain, not cover), optional shimmer under
// cinematic motion.
import type { ReactNode } from "react";
import {
  CircleDashed,
  Loader,
  ShieldCheck,
  ShieldAlert,
  RotateCcw,
} from "lucide-react";
import { INK } from "../visualizations/common";
import { SWA } from "../engine/swa";

interface InspectorChromeProps {
  status: "idle" | "running" | "done" | "error";
  stage: number;
  shimmer: boolean;
  controls: ReactNode;
  onReset: () => void;
  children: ReactNode;
}

// Trust-context cell -- renders one key/value in the context bar.
function CtxCell({
  k,
  v,
  wide,
  brand,
}: {
  k: string;
  v: string;
  wide?: boolean;
  brand?: boolean;
}) {
  return (
    <div style={{ ...ic.ctxCell, flex: wide ? 1.4 : 1 }}>
      <span style={ic.ctxK}>{k}</span>
      <span style={{ ...ic.ctxV, color: brand ? INK.mono : INK.text }}>
        {v}
      </span>
    </div>
  );
}

// Phase icon for the status footer.
function PhaseIcon({
  status,
  tone,
}: {
  status: "idle" | "running" | "done" | "error";
  tone: string;
}) {
  const s = { width: 13, height: 13, color: tone };
  switch (status) {
    case "idle":
      return <CircleDashed style={s} />;
    case "running":
      return (
        <Loader style={{ ...s, animation: "icSpin 1s linear infinite" }} />
      );
    case "done":
      return <ShieldCheck style={s} />;
    case "error":
      return <ShieldAlert style={s} />;
  }
}

export function InspectorChrome({
  status,
  stage,
  shimmer,
  controls,
  onReset,
  children,
}: InspectorChromeProps) {
  // Stage verb for the running phase text.
  const stageEntry = stage >= 0 ? SWA.stages[stage] : undefined;
  const verb = stageEntry?.verb.toLowerCase() ?? "starting";

  const phase =
    status === "idle"
      ? { txt: "Click resolve to begin", tone: INK.dim }
      : status === "running"
        ? { txt: `Resolving · ${verb}`, tone: "#9DB4FF" }
        : status === "done"
          ? {
              txt: "Resolved · secret delivered in memory, never stored",
              tone: INK.ok,
            }
          : { txt: "Rejected · untrusted authority", tone: INK.danger };

  const t = SWA.trust;

  return (
    <div style={ic.root}>
      {/* bgLayers correction: contain, not cover. Fade mask to the left. */}
      <div style={ic.bgLayers} />
      {/* shimmer only when motion=cinematic and shimmer toggle on */}
      {shimmer && <div className="ic-flow" style={ic.shimmer} />}

      <header style={ic.head}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <img
            src="/assets/idira-icon-white.png"
            alt="Idira"
            style={{ height: 24, width: "auto", opacity: 0.95 }}
          />
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              lineHeight: 1.1,
            }}
          >
            <span
              style={{
                fontSize: 13.5,
                fontWeight: 700,
                color: INK.text,
                letterSpacing: "0.02em",
              }}
            >
              Idira Inspector
            </span>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                color: INK.faint,
                letterSpacing: "0.04em",
              }}
            >
              spiffe · mtls · jwt-svid
            </span>
          </div>
        </div>
        {controls}
      </header>

      {/* trust-context bar */}
      <div style={ic.ctx}>
        <CtxCell k="Trust domain" v={t.domain} wide />
        <CtxCell k="Server group" v={t.serverGroup} />
        <CtxCell k="Node group" v={t.nodeGroup} />
        <CtxCell k="Attestor" v={t.attestor} brand />
      </div>

      {/* visualization slot */}
      <div style={ic.stage}>{children}</div>

      {/* status footer */}
      <footer style={ic.footer}>
        <div style={{ ...ic.phase, color: phase.tone }}>
          <PhaseIcon status={status} tone={phase.tone} />
          <span>{phase.txt}</span>
        </div>
        {status !== "idle" && (
          <button
            onClick={onReset}
            style={ic.resetBtn}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = INK.text;
              e.currentTarget.style.borderColor = "rgba(255,255,255,0.25)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = INK.dim;
              e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)";
            }}
          >
            <RotateCcw style={{ width: 12, height: 12 }} /> Reset
          </button>
        )}
      </footer>
    </div>
  );
}

const ic = {
  root: {
    position: "relative" as const,
    height: "100%",
    display: "flex",
    flexDirection: "column" as const,
    background:
      "radial-gradient(120% 90% at 80% 0%, #0E2A78 0%, #061D63 38%, #050F38 100%)",
    color: INK.text,
    overflow: "hidden",
  },
  // bgLayers correction is load-bearing: contain (not cover) prevents
  // upscaling the 1024x569 artwork ~1.6x, which blurs bars and blows
  // out the bright cluster. Validator inspects computed styles.
  bgLayers: {
    position: "absolute" as const,
    inset: 0,
    backgroundImage: "url('/assets/security-layers-blue.png')",
    backgroundRepeat: "no-repeat",
    backgroundSize: "contain",
    backgroundPosition: "right bottom",
    opacity: 0.45,
    pointerEvents: "none" as const,
    maskImage: "linear-gradient(to left, #000 35%, transparent 92%)",
    WebkitMaskImage: "linear-gradient(to left, #000 35%, transparent 92%)",
  },
  shimmer: {
    position: "absolute" as const,
    top: 0,
    right: 0,
    width: "55%",
    height: "100%",
    background:
      "linear-gradient(105deg, transparent 30%, rgba(97,134,252,0.10) 50%, transparent 70%)",
    backgroundSize: "260% 100%",
    pointerEvents: "none" as const,
    animation: "icShimmer 7s linear infinite",
    zIndex: 1,
  },
  head: {
    position: "relative" as const,
    zIndex: 2,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "16px 30px",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
    flexShrink: 0,
  },
  ctx: {
    position: "relative" as const,
    zIndex: 2,
    display: "flex",
    gap: 0,
    padding: "14px 30px",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
    flexShrink: 0,
  },
  ctxCell: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 3,
    paddingRight: 18,
  },
  ctxK: {
    fontSize: 9,
    letterSpacing: "0.14em",
    textTransform: "uppercase" as const,
    color: INK.faint,
    fontWeight: 600,
  },
  ctxV: {
    fontFamily: "var(--font-mono)",
    fontSize: 13,
    fontWeight: 500,
  },
  stage: {
    position: "relative" as const,
    zIndex: 2,
    flex: 1,
    minHeight: 0,
    overflow: "hidden",
  },
  footer: {
    position: "relative" as const,
    zIndex: 2,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "11px 30px",
    borderTop: "1px solid rgba(255,255,255,0.07)",
    flexShrink: 0,
    background: "rgba(4,12,40,0.5)",
  },
  phase: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12,
    fontWeight: 600,
    fontFamily: "var(--font-mono)",
    letterSpacing: "0.01em",
  },
  resetBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    color: INK.dim,
    background: "transparent",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 7,
    padding: "5px 11px",
    cursor: "pointer",
    transition: "all 160ms var(--ease-standard)",
    letterSpacing: "0.02em",
  },
};
