// TopologyInspector -- the live trust-path diagram (hero visualization).
// Vertical topology: two X.509 workloads under an mTLS bracket, descending
// through JWT-SVID, Secrets Manager, Secret. Edges carry energy pulses as
// each stage fires. Ported from inspector_topology.jsx.
import { ShieldX, Lock, CircleCheckBig, ShieldOff } from "lucide-react";
import { INK, Meter, Kv, fmtTtl, type InspectorProps } from "./common";
import { SWA } from "../engine/swa";

type CardVisualState = "locked" | "active" | "done";

// Determines the visual state of a topology card based on engine progress.
function cardState(
  reachedAfter: number,
  completed: number,
  activeStage: number,
  errored: boolean,
  failStage: number,
): CardVisualState {
  if (errored && reachedAfter >= failStage) return "locked";
  if (completed > reachedAfter) return "done";
  if (activeStage === reachedAfter) return "active";
  return "locked";
}

// Vertical connector with energy pulse between topology rows.
function VLink({ state }: { state: CardVisualState }) {
  return (
    <div style={ts.vlinkWrap}>
      <div
        style={{
          ...ts.vlinkBase,
          background:
            state === "done" ? "var(--idira-blue-500)" : INK.line,
        }}
      >
        {state === "active" && (
          <div className="ic-flow" style={ts.vlinkPulse} />
        )}
      </div>
      {state !== "locked" && (
        <div
          style={{
            ...ts.vArrow,
            borderTopColor:
              state === "done" ? "var(--idira-blue-500)" : INK.mono,
          }}
        />
      )}
    </div>
  );
}

// Node card -- represents a stage in the topology.
function NodeCard({
  title,
  tag,
  state,
  danger = false,
  children,
  accent,
}: {
  title: string;
  tag?: string;
  state: CardVisualState;
  danger?: boolean;
  children?: React.ReactNode;
  accent?: React.ReactNode;
}) {
  const isActive = state === "active";
  const isDone = state === "done";
  const border = danger
    ? INK.dangerLine
    : isDone || isActive
      ? "var(--idira-blue-500)"
      : INK.line;

  return (
    <div
      style={{
        ...ts.card,
        borderColor: border,
        borderStyle: danger ? "dashed" : "solid",
        background: danger
          ? "rgba(250,88,45,0.07)"
          : isActive
            ? INK.cardActive
            : isDone
              ? "rgba(38,91,255,0.07)"
              : INK.card,
        boxShadow: isActive
          ? "0 0 0 1px var(--idira-blue-500), 0 8px 30px rgba(38,91,255,0.25)"
          : "none",
        opacity: state === "locked" && !children ? 0.55 : 1,
        animation: isActive
          ? "topoPop 360ms var(--ease-emphasis) both"
          : "none",
      }}
    >
      <div style={ts.cardHead}>
        <span
          style={{
            ...ts.cardTitle,
            color: danger ? INK.danger : INK.text,
          }}
        >
          <span
            style={{
              ...ts.cornerTick,
              borderColor: danger
                ? INK.danger
                : "var(--idira-blue-500)",
              opacity: isDone || isActive || danger ? 1 : 0.2,
            }}
          />
          {title}
        </span>
        {tag && (
          <span
            style={{
              ...ts.cardTag,
              color: danger
                ? INK.danger
                : isDone
                  ? INK.ok
                  : INK.mono,
            }}
          >
            {tag}
          </span>
        )}
        {accent}
      </div>
      {children}
    </div>
  );
}

export function TopologyInspector({
  status,
  stage,
  completed,
  carrier,
  jwtTtl,
}: InspectorProps) {
  const ext = carrier === "external";
  const errored = status === "error";

  const issued = completed > 0 || stage === 0;
  const certPct = completed > 0 ? 96 : stage === 0 ? 60 : 0;

  // mTLS state
  const mtlsState: "rejected" | "done" | "active" | "locked" = errored
    ? "rejected"
    : completed > 1
      ? "done"
      : stage === 1
        ? "active"
        : "locked";

  const jwtState = cardState(2, completed, stage, errored, 2);
  const smState = cardState(3, completed, stage, errored, 2);
  const secState = cardState(4, completed, stage, errored, 2);

  const linkJwt: CardVisualState = errored
    ? "locked"
    : completed > 2
      ? "done"
      : stage === 2
        ? "active"
        : "locked";
  const linkAuthn: CardVisualState = errored
    ? "locked"
    : completed > 3
      ? "done"
      : stage === 3
        ? "active"
        : "locked";
  const linkFetch: CardVisualState = errored
    ? "locked"
    : completed > 4
      ? "done"
      : stage === 4
        ? "active"
        : "locked";

  return (
    <div style={ts.scroll}>
      <div style={ts.canvas}>
        {/* mTLS bracket chip */}
        <div style={ts.mtlsChipWrap}>
          <div
            style={{
              ...ts.mtlsChip,
              color:
                mtlsState === "rejected"
                  ? INK.danger
                  : mtlsState === "done"
                    ? INK.ok
                    : mtlsState === "active"
                      ? INK.mono
                      : INK.dim,
              borderColor:
                mtlsState === "rejected"
                  ? INK.dangerLine
                  : mtlsState === "done" || mtlsState === "active"
                    ? "var(--idira-blue-500)"
                    : INK.line,
              background:
                mtlsState === "rejected"
                  ? "rgba(250,88,45,0.1)"
                  : "rgba(6,18,55,0.7)",
            }}
          >
            {mtlsState === "rejected" ? (
              <ShieldX style={{ width: 12, height: 12 }} />
            ) : (
              <Lock style={{ width: 12, height: 12 }} />
            )}
            {mtlsState === "rejected"
              ? "mTLS rejected · untrusted authority"
              : mtlsState === "done"
                ? `mTLS ok · ${SWA.cipher}`
                : mtlsState === "active"
                  ? "negotiating mutual TLS..."
                  : "mutual TLS"}
          </div>
        </div>

        {/* Portal + Carrier pair row */}
        <div style={ts.pairRow}>
          <NodeCard
            title="Portal"
            tag="X.509-SVID"
            state={
              completed > 0 ? "done" : stage === 0 ? "active" : "locked"
            }
          >
            <Kv k="SAN URI" v={SWA.spiffe.portal} />
            <div style={ts.validRow}>
              <span style={ts.validLbl}>VALID</span>
              <span style={ts.validVal}>{issued ? "58m" : "-"}</span>
            </div>
            <Meter pct={certPct} active={stage === 0} />
            <span style={ts.foot}>RSA-2048 · rotates 60m</span>
          </NodeCard>

          {/* horizontal mTLS connector */}
          <div style={ts.hlink}>
            <div
              style={{
                ...ts.hlinkBase,
                background:
                  mtlsState === "rejected"
                    ? INK.dangerLine
                    : mtlsState === "done"
                      ? "var(--idira-blue-500)"
                      : INK.line,
              }}
            >
              {mtlsState === "active" && (
                <div className="ic-flow" style={ts.hlinkPulse} />
              )}
            </div>
          </div>

          <NodeCard
            title={ext ? "ACME" : "Carrier"}
            tag={ext ? "Foreign TD" : "X.509-SVID"}
            danger={ext}
            state={
              completed > 0 ? "done" : stage === 0 ? "active" : "locked"
            }
          >
            <Kv
              k="SAN URI"
              v={ext ? SWA.spiffe.foreign : SWA.spiffe.carrier}
              vColor={ext ? INK.danger : undefined}
            />
            <div style={ts.validRow}>
              <span style={ts.validLbl}>VALID</span>
              <span style={ts.validVal}>{issued ? "59m" : "-"}</span>
            </div>
            <Meter
              pct={certPct}
              tone={ext ? "danger" : "brand"}
              active={stage === 0}
            />
            <span style={ts.foot}>
              {ext ? "issuer: acme.courier CA" : "RSA-2048 · rotates 60m"}
            </span>
          </NodeCard>
        </div>

        <VLink state={linkJwt} />

        {/* JWT-SVID */}
        <NodeCard
          title="Carrier · JWT-SVID"
          tag={jwtState === "done" ? "accepted" : ext ? "-" : "on resolve"}
          state={jwtState}
        >
          {jwtState === "done" ? (
            <div style={ts.grid2}>
              <div style={{ gridColumn: "1 / -1" }}>
                <Kv k="sub claim" v={SWA.spiffe.carrier} />
              </div>
              <Kv k="aud" v={SWA.jwt.aud} />
              <Kv k="alg" v={SWA.jwt.alg} />
              <Kv k="kid" v={SWA.jwt.kid} />
              <div>
                <span style={ts.validLbl}>TTL</span>
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 14,
                    color: INK.ok,
                    marginTop: 2,
                  }}
                >
                  {fmtTtl(jwtTtl)}
                </div>
              </div>
              <div style={{ gridColumn: "1 / -1", marginTop: 2 }}>
                <Meter
                  pct={Math.round((jwtTtl / 300) * 100)}
                  tone="brand"
                  active
                />
                <span style={{ ...ts.foot, marginTop: 6 }}>
                  signed by trust-domain JWKS · aud-bound to conjur
                </span>
              </div>
            </div>
          ) : (
            <span style={ts.dimNote}>
              issued on resolve · aud=conjur · alg=RS512 · ttl 5m
            </span>
          )}
        </NodeCard>

        <VLink state={linkAuthn} />

        {/* Secrets Manager */}
        <NodeCard
          title="Secrets Manager · SaaS"
          tag={smState === "done" ? "token granted" : ""}
          state={smState}
        >
          {smState === "done" ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <span style={ts.okNote}>
                POST /authn-jwt · JWKS verified · access token issued
              </span>
              <span style={ts.foot}>
                scoped to{" "}
                <b style={{ color: INK.mono }}>{SWA.secret.variable}</b> ·
                policy denies all others
              </span>
            </div>
          ) : (
            <span style={ts.dimNote}>
              policy scoped to exactly one variable
            </span>
          )}
        </NodeCard>

        <VLink state={linkFetch} />

        {/* Secret */}
        <NodeCard
          title="Secret"
          tag={secState === "done" ? "returned" : ""}
          state={secState}
        >
          {secState === "done" ? (
            <span style={ts.okNote}>
              bytes={SWA.secret.bytes} · in-process · held for one request ·
              never on disk
            </span>
          ) : (
            <span style={ts.dimNote}>in-process · never on disk</span>
          )}
        </NodeCard>

        {/* trust boundary band for external */}
        {errored && (
          <div style={ts.boundary}>
            <span style={{ ...ts.cardTitle, color: INK.danger }}>
              <ShieldOff style={{ width: 13, height: 13 }} /> Trust boundary
            </span>
            <span style={ts.boundaryBody}>
              acme.courier is outside idira.demo -- no shared trust roots.
              SWA trust-domain federation would resolve this; not yet
              available in this demo.
            </span>
          </div>
        )}

        {status === "done" && (
          <div style={ts.resolved}>
            <CircleCheckBig style={{ width: 14, height: 14 }} />
            manifest returned to portal · zero credentials stored
          </div>
        )}
      </div>
    </div>
  );
}

const ts = {
  scroll: {
    height: "100%",
    overflowY: "auto" as const,
    padding: "22px 30px 30px",
  },
  canvas: {
    maxWidth: 560,
    margin: "0 auto",
    display: "flex",
    flexDirection: "column" as const,
  },
  mtlsChipWrap: {
    display: "flex",
    justifyContent: "center",
    marginBottom: 12,
  },
  mtlsChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    fontFamily: "var(--font-mono)",
    fontSize: 11.5,
    padding: "6px 13px",
    borderRadius: 999,
    border: "1px solid",
    letterSpacing: "0.01em",
    transition: "all 300ms var(--ease-standard)",
  },
  pairRow: {
    display: "grid",
    gridTemplateColumns: "1fr auto 1fr",
    alignItems: "center",
    gap: 0,
  },
  hlink: {
    width: 34,
    height: 2,
    position: "relative" as const,
    alignSelf: "center" as const,
  },
  hlinkBase: {
    position: "absolute" as const,
    inset: 0,
    borderRadius: 2,
    transition: "background 300ms",
  },
  hlinkPulse: {
    position: "absolute" as const,
    top: 0,
    left: 0,
    height: "100%",
    width: "45%",
    background:
      "linear-gradient(90deg, transparent, #9DB4FF, transparent)",
    animation: "topoFlowX 0.9s linear infinite",
  },
  card: {
    flex: 1,
    display: "flex",
    flexDirection: "column" as const,
    gap: 9,
    padding: "14px 16px",
    border: "1px solid",
    borderRadius: "var(--radius-md)",
    transition: "all 320ms var(--ease-standard)",
    backdropFilter: "blur(2px)",
  },
  cardHead: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    justifyContent: "space-between",
  },
  cardTitle: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
  },
  cornerTick: {
    width: 7,
    height: 7,
    borderLeft: "2px solid",
    borderTop: "2px solid",
    display: "inline-block",
  },
  cardTag: {
    fontFamily: "var(--font-mono)",
    fontSize: 10.5,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    fontWeight: 600,
  },
  validRow: {
    display: "flex",
    alignItems: "baseline",
    gap: 10,
    marginTop: 2,
  },
  validLbl: {
    fontSize: 9.5,
    letterSpacing: "0.12em",
    textTransform: "uppercase" as const,
    color: INK.faint,
    fontWeight: 600,
  },
  validVal: {
    fontFamily: "var(--font-mono)",
    fontSize: 15,
    color: INK.text,
    fontWeight: 600,
  },
  foot: {
    fontFamily: "var(--font-mono)",
    fontSize: 10.5,
    color: INK.faint,
    letterSpacing: "0.02em",
  },
  vlinkWrap: {
    position: "relative" as const,
    height: 34,
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
  },
  vlinkBase: {
    position: "relative" as const,
    width: 2,
    height: "100%",
    overflow: "hidden",
    transition: "background 300ms",
  },
  vlinkPulse: {
    position: "absolute" as const,
    top: 0,
    left: 0,
    width: "100%",
    height: "50%",
    background:
      "linear-gradient(180deg, transparent, #9DB4FF, transparent)",
    animation: "topoFlowY 0.9s linear infinite",
  },
  vArrow: {
    position: "absolute" as const,
    bottom: -1,
    width: 0,
    height: 0,
    borderLeft: "4px solid transparent",
    borderRight: "4px solid transparent",
    borderTop: "5px solid",
  },
  grid2: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1fr",
    gap: "11px 14px",
  },
  dimNote: {
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    color: INK.faint,
    fontStyle: "italic" as const,
  },
  okNote: {
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    color: INK.text,
    lineHeight: 1.5,
  },
  boundary: {
    marginTop: 20,
    padding: "13px 16px",
    border: `1.5px dashed ${INK.dangerLine}`,
    borderRadius: "var(--radius-md)",
    background: "rgba(250,88,45,0.07)",
    display: "flex",
    flexDirection: "column" as const,
    gap: 7,
    animation: "topoPop 360ms var(--ease-emphasis) both",
  },
  boundaryBody: {
    fontFamily: "var(--font-mono)",
    fontSize: 11.5,
    color: "rgba(255,180,150,0.85)",
    lineHeight: 1.55,
  },
  resolved: {
    marginTop: 18,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    fontSize: 12,
    fontWeight: 600,
    color: INK.ok,
    fontFamily: "var(--font-mono)",
    animation: "topoPop 360ms var(--ease-emphasis) both",
  },
};
