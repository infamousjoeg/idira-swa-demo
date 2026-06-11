// LayersInspector -- the security-layers "gates of defense" visualization.
// Five horizontal layers illuminate left-to-right as each fires. The
// bar-curtain motif fills as stages pass. Ported from inspector_layers.jsx.
import {
  Fingerprint,
  Lock,
  BadgeCheck,
  KeyRound,
  ShieldCheck,
  Check,
  X,
  ShieldOff,
} from "lucide-react";
import { INK, Meter, fmtTtl, type InspectorProps } from "./common";
import { ShuffleDigits } from "./ShuffleDigits";
import { SWA } from "../engine/swa";

type LayerState = "locked" | "active" | "passed" | "rejected";

interface LayerDef {
  name: string;
  Icon: React.ComponentType<{ style?: React.CSSProperties }>;
  pass: string | (() => string);
  idle: string;
}

// Five layers in order: icons match the spec requirement exactly.
const LAYERS: LayerDef[] = [
  {
    name: "Node attestation",
    Icon: Fingerprint,
    pass: "k8s_psat verified · X.509-SVIDs issued",
    idle: "attest the node identity",
  },
  {
    name: "Mutual TLS",
    Icon: Lock,
    pass: () => `${SWA.cipher} · peers verified by SPIFFE ID`,
    idle: "establish mTLS between workloads",
  },
  {
    name: "JWT-SVID",
    Icon: BadgeCheck,
    pass: () => `aud=${SWA.jwt.aud} · ${SWA.jwt.alg} · signed by JWKS`,
    idle: "mint a workload token",
  },
  {
    name: "Access token",
    Icon: KeyRound,
    pass: () => `scoped to ${SWA.secret.variable}`,
    idle: "exchange JWT at Secrets Manager",
  },
  {
    name: "Secret",
    Icon: ShieldCheck,
    pass: () => `${SWA.secret.bytes} bytes · in-process · never on disk`,
    idle: "fetch and hold in memory only",
  },
];

// Curtain -- decorative bar motif on the right edge of each layer card.
function Curtain({ state }: { state: LayerState }) {
  const bars = Array.from({ length: 22 });
  return (
    <div style={ls.curtain}>
      {bars.map((_, i) => {
        const danger = state === "rejected";
        const lit = state === "passed" || state === "active";
        return (
          <span
            key={i}
            className={state === "active" ? "ic-flow" : undefined}
            style={{
              flex: 1,
              background: danger
                ? "linear-gradient(180deg, #FF724D, #B23808)"
                : "linear-gradient(180deg, #6186FC, #173EB8)",
              opacity: lit
                ? 0.35 + 0.65 * Math.sin((i / bars.length) * Math.PI)
                : 0.08,
              transform: lit ? "scaleY(1)" : "scaleY(0.45)",
              transformOrigin: "bottom",
              transition: `opacity 420ms ${i * 22}ms var(--ease-standard), transform 420ms ${i * 22}ms var(--ease-emphasis)`,
              animation:
                state === "active"
                  ? `layShimmer 1.1s ${i * 40}ms ease-in-out infinite`
                  : "none",
              borderRadius: 1,
            }}
          />
        );
      })}
    </div>
  );
}

export function LayersInspector({
  status,
  stage,
  completed,
  jwtTtl,
}: InspectorProps) {
  const errored = status === "error";

  const stateFor = (idx: number): LayerState => {
    if (errored) {
      if (idx === 1) return "rejected";
      if (idx > 1) return "locked";
    }
    if (completed > idx) return "passed";
    if (stage === idx) return "active";
    return "locked";
  };

  const passedCount = errored ? 1 : completed;

  // Rail dot position: tracks the active/completed stage.
  const dotPos =
    errored
      ? 1
      : stage >= 0
        ? stage
        : status === "done"
          ? 5
          : 0;
  const railDotTop = `calc(${(Math.min(dotPos + 0.5, 5) / 5) * 100}%)`;

  return (
    <div style={ls.scroll}>
      <div style={ls.canvas}>
        <div style={ls.headline}>
          <span className="idira-eyebrow" style={{ color: INK.mono }}>
            Layers of defense
          </span>
          <span style={ls.headSub}>
            {status === "idle"
              ? "five gates between the request and the secret"
              : errored
                ? "the request stopped at the trust boundary"
                : status === "done"
                  ? "every gate cleared by cryptographic identity"
                  : "the request is descending the trust path..."}
          </span>
        </div>

        <div style={ls.stack}>
          {/* descent rail */}
          <div style={ls.rail}>
            <div
              style={{
                ...ls.railFill,
                height: `${(Math.min(passedCount, 5) / 5) * 100}%`,
                background: errored
                  ? INK.dangerLine
                  : "var(--idira-blue-500)",
              }}
            />
            <div
              style={{
                ...ls.railDot,
                top: railDotTop,
                background: errored ? INK.danger : "#9DB4FF",
                display: status === "idle" ? "none" : "block",
              }}
            />
          </div>

          <div style={ls.layers}>
            {LAYERS.map((L, i) => {
              const st = stateFor(i);
              const danger = st === "rejected";
              const lit = st === "passed" || st === "active";
              const passText =
                typeof L.pass === "function" ? L.pass() : L.pass;

              return (
                <div
                  key={i}
                  style={{
                    ...ls.layer,
                    borderColor: danger
                      ? INK.dangerLine
                      : lit
                        ? "var(--idira-blue-500)"
                        : INK.line,
                    background: danger
                      ? "rgba(250,88,45,0.08)"
                      : st === "active"
                        ? "rgba(38,91,255,0.12)"
                        : st === "passed"
                          ? "rgba(38,91,255,0.06)"
                          : "rgba(120,150,255,0.03)",
                    boxShadow:
                      st === "active"
                        ? "0 0 0 1px var(--idira-blue-500), 0 10px 30px rgba(38,91,255,0.22)"
                        : "none",
                    opacity: st === "locked" ? 0.5 : 1,
                  }}
                >
                  <div
                    style={{
                      ...ls.num,
                      color: danger
                        ? INK.danger
                        : lit
                          ? "#fff"
                          : INK.faint,
                      background: danger
                        ? "rgba(250,88,45,0.18)"
                        : lit
                          ? "var(--idira-blue-500)"
                          : "rgba(255,255,255,0.05)",
                    }}
                  >
                    {st === "passed" ? (
                      <Check style={{ width: 15, height: 15 }} />
                    ) : danger ? (
                      <X style={{ width: 15, height: 15 }} />
                    ) : (
                      <L.Icon style={{ width: 15, height: 15 }} />
                    )}
                  </div>

                  <div style={ls.meta}>
                    <div style={ls.layerName}>
                      {L.name}
                      <span
                        style={{
                          ...ls.layerStatus,
                          color: danger
                            ? INK.danger
                            : st === "passed"
                              ? INK.ok
                              : st === "active"
                                ? INK.mono
                                : INK.faint,
                        }}
                      >
                        {danger
                          ? "rejected"
                          : st === "passed"
                            ? "cleared"
                            : st === "active"
                              ? "verifying..."
                              : "waiting"}
                      </span>
                    </div>
                    <div
                      style={{
                        ...ls.layerDetail,
                        color:
                          lit && !danger
                            ? INK.dim
                            : danger
                              ? "rgba(255,170,140,0.85)"
                              : INK.faint,
                      }}
                    >
                      {danger
                        ? "acme.courier signed by a CA your trust domain does not know"
                        : st === "passed"
                          ? passText
                          : st === "active"
                            ? passText
                            : L.idle}
                    </div>
                    {i === 2 && st === "passed" && (
                      <div style={{ marginTop: 7 }}>
                        <Meter
                          pct={Math.round((jwtTtl / 300) * 100)}
                          active
                        />
                        <span
                          style={{
                            fontFamily: "var(--font-mono)",
                            fontSize: 10,
                            color: INK.faint,
                            marginTop: 4,
                            display: "block",
                          }}
                        >
                          token ttl <ShuffleDigits value={fmtTtl(jwtTtl)} />
                        </span>
                      </div>
                    )}
                  </div>

                  <Curtain state={st} />
                </div>
              );
            })}
          </div>
        </div>

        {errored && (
          <div style={ls.boundary}>
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 11.5,
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: INK.danger,
              }}
            >
              <ShieldOff style={{ width: 13, height: 13 }} /> Trust boundary
              held
            </span>
            <span style={ls.boundaryBody}>
              No JWT-SVID issued, no Secrets Manager call, no secret fetched.
              The handshake failed before any application data crossed the
              wire -- exactly as designed.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

const ls = {
  scroll: {
    height: "100%",
    overflowY: "auto" as const,
    padding: "24px 32px 32px",
  },
  canvas: { maxWidth: 580, margin: "0 auto" },
  headline: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 4,
    marginBottom: 18,
  },
  headSub: { fontSize: 13.5, color: INK.dim, lineHeight: 1.4 },
  stack: { display: "flex", gap: 16 },
  rail: {
    position: "relative" as const,
    width: 3,
    borderRadius: 3,
    background: "rgba(255,255,255,0.07)",
    flexShrink: 0,
    marginTop: 6,
    marginBottom: 6,
  },
  railFill: {
    position: "absolute" as const,
    top: 0,
    left: 0,
    width: "100%",
    borderRadius: 3,
    transition: "height 600ms var(--ease-emphasis)",
  },
  railDot: {
    position: "absolute" as const,
    left: "50%",
    width: 11,
    height: 11,
    borderRadius: 999,
    transform: "translate(-50%,-50%)",
    boxShadow: "0 0 12px #9DB4FF",
    transition: "top 600ms var(--ease-emphasis)",
  },
  layers: {
    flex: 1,
    display: "flex",
    flexDirection: "column" as const,
    gap: 12,
  },
  layer: {
    position: "relative" as const,
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: "14px 16px",
    border: "1px solid",
    borderRadius: "var(--radius-md)",
    overflow: "hidden",
    transition: "all 340ms var(--ease-standard)",
    minHeight: 74,
  },
  num: {
    width: 34,
    height: 34,
    borderRadius: 9,
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    transition: "all 320ms",
  },
  meta: { flex: 1, minWidth: 0, zIndex: 1 },
  layerName: {
    display: "flex",
    alignItems: "baseline",
    gap: 10,
    fontSize: 14.5,
    fontWeight: 700,
    color: INK.text,
    fontFamily: "var(--font-display)",
  },
  layerStatus: {
    fontFamily: "var(--font-mono)",
    fontSize: 10,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    fontWeight: 600,
  },
  layerDetail: {
    fontFamily: "var(--font-mono)",
    fontSize: 11.5,
    lineHeight: 1.45,
    marginTop: 3,
  },
  curtain: {
    position: "absolute" as const,
    right: 0,
    top: 0,
    bottom: 0,
    width: "38%",
    display: "flex",
    gap: 2,
    alignItems: "stretch",
    padding: "10px 0",
    opacity: 0.9,
    maskImage: "linear-gradient(90deg, transparent, #000 60%)",
    WebkitMaskImage: "linear-gradient(90deg, transparent, #000 60%)",
    pointerEvents: "none" as const,
  },
  boundary: {
    marginTop: 18,
    padding: "14px 16px",
    border: `1.5px dashed ${INK.dangerLine}`,
    borderRadius: "var(--radius-md)",
    background: "rgba(250,88,45,0.07)",
    display: "flex",
    flexDirection: "column" as const,
    gap: 7,
    animation: "layPop 360ms var(--ease-emphasis) both",
  },
  boundaryBody: {
    fontFamily: "var(--font-mono)",
    fontSize: 11.5,
    color: "rgba(255,180,150,0.85)",
    lineHeight: 1.55,
  },
};
