// TraceInspector -- the streaming identity trace (SSE log visualization).
// A compact node strip across the top; below it, timestamped event rows
// stream in with terminal cursor blink. Brand-correct, not a raw console.
// Ported from inspector_trace.jsx.
import { Fragment, useRef, useEffect } from "react";
import {
  Globe,
  Box,
  Cpu,
  Database,
  KeyRound,
  ArrowRight,
  Check,
  ShieldOff,
} from "lucide-react";
import { INK, Meter, fmtTtl, type InspectorProps } from "./common";
import { ShuffleDigits } from "./ShuffleDigits";
import { SWA } from "../engine/swa";

// Node strip definitions: the five participants in the identity exchange.
const TRACE_NODES = [
  { id: "portal", label: "Portal", Icon: Globe },
  { id: "carrier", label: "Carrier", Icon: Box },
  { id: "agent", label: "Agent", Icon: Cpu },
  { id: "sm", label: "Secrets Mgr", Icon: Database },
  { id: "secret", label: "Secret", Icon: KeyRound },
] as const;

interface TraceEvent {
  s: number;
  k: "req" | "res";
  type: string;
  src: string;
  dst: string;
  msg: string;
  ms: number;
  tone?: "ok" | "err";
}

// Template events for the trace log. These are NOT real SSE events;
// they are predetermined event templates that are revealed/hidden based
// on engine state (stage, completed). All three visualizations read the
// SAME engine state.
function buildEvents(ext: boolean): TraceEvent[] {
  const base: TraceEvent[] = [
    { s: 0, k: "req", type: "attest", src: "agent", dst: "control-plane", msg: "node attestation · k8s_psat", ms: 0 },
    { s: 0, k: "res", type: "x509", src: "swa-server", dst: "portal · carrier", msg: "X.509-SVID issued to both workloads · RSA-2048", ms: 4, tone: "ok" },
    { s: 1, k: "req", type: "mtls", src: "portal", dst: "carrier", msg: "opening mutual TLS", ms: 28 },
  ];
  if (ext) {
    base.push({
      s: 1,
      k: "res",
      type: "mtls",
      src: "portal",
      dst: "acme.courier",
      msg: "REJECTED · untrusted authority · no shared trust roots",
      ms: 46,
      tone: "err",
    });
    return base;
  }
  return base.concat([
    { s: 1, k: "res", type: "mtls", src: "portal", dst: "carrier", msg: `peer verified by SPIFFE ID · ${SWA.cipher}`, ms: 47, tone: "ok" },
    { s: 2, k: "req", type: "jwt", src: "carrier", dst: "agent", msg: "workload API · request JWT-SVID aud=conjur", ms: 52 },
    { s: 2, k: "res", type: "jwt", src: "agent", dst: "carrier", msg: "JWT-SVID minted · RS512 · kid b28ff935... · ttl 5m", ms: 74, tone: "ok" },
    { s: 3, k: "req", type: "http", src: "carrier", dst: "secrets-manager", msg: "POST /api/authn-jwt", ms: 79 },
    { s: 3, k: "res", type: "authn", src: "secrets-manager", dst: "carrier", msg: "JWKS verified · access token granted", ms: 121, tone: "ok" },
    { s: 4, k: "req", type: "http", src: "carrier", dst: "secrets-manager", msg: "GET swa-demo/carrier/api-key", ms: 126 },
    { s: 4, k: "res", type: "secret", src: "secrets-manager", dst: "carrier", msg: "200 · 32 bytes · in-process · never on disk", ms: 148, tone: "ok" },
    { s: 5, k: "req", type: "lookup", src: "carrier", dst: "fixture", msg: "resolve shipment SHP-2049-883", ms: 152 },
    { s: 5, k: "res", type: "render", src: "carrier", dst: "portal", msg: "200 · manifest returned to portal", ms: 163, tone: "ok" },
  ]);
}

const TYPE_COLORS: Record<string, string> = {
  attest: "#9DB4FF",
  x509: "#43E08B",
  mtls: "#6186FC",
  jwt: "#43E08B",
  http: "#9DB4FF",
  authn: "#43E08B",
  secret: "#43E08B",
  lookup: "#9DB4FF",
  render: "#43E08B",
};

export function TraceInspector({
  status,
  stage,
  completed,
  carrier,
  jwtTtl,
}: InspectorProps) {
  const ext = carrier === "external";
  const errored = status === "error";
  const all = buildEvents(ext);

  // Filter events based on engine state. Request events appear when
  // their stage is active or completed; response events appear when
  // their stage is completed (or for error responses, when errored).
  const visible = all.filter((e) => {
    if (e.k === "req") return e.s <= completed || stage >= e.s;
    if (errored && e.tone === "err") return true;
    return completed > e.s;
  });

  // Auto-scroll the log to the bottom as events appear.
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [visible.length, status]);

  // Node strip lighting state.
  const nodeLit: Record<string, boolean> = {
    portal: completed > 0 || (stage >= 0 && status !== "idle"),
    carrier: completed > 0 || (stage >= 0 && status !== "idle"),
    agent: completed > 2,
    sm: completed > 3,
    secret: completed > 4,
  };
  const activeNode = errored
    ? "carrier"
    : stage === 2
      ? "agent"
      : stage === 3 || stage === 4
        ? "sm"
        : stage === 5
          ? "portal"
          : stage >= 0
            ? "carrier"
            : null;

  return (
    <div style={tc.root}>
      {/* node strip */}
      <div style={tc.strip}>
        {TRACE_NODES.map((n, i) => {
          const lit = status !== "idle" && (nodeLit[n.id] ?? false);
          const active = activeNode === n.id;
          const danger = errored && n.id === "carrier";
          return (
            <Fragment key={n.id}>
              <div
                style={{
                  ...tc.node,
                  borderColor: danger
                    ? INK.dangerLine
                    : active
                      ? "var(--idira-blue-500)"
                      : lit
                        ? "rgba(97,134,252,0.5)"
                        : INK.line,
                  background: danger
                    ? "rgba(250,88,45,0.12)"
                    : active
                      ? "rgba(38,91,255,0.16)"
                      : lit
                        ? "rgba(38,91,255,0.06)"
                        : "rgba(255,255,255,0.02)",
                  boxShadow: active
                    ? "0 0 0 1px var(--idira-blue-500), 0 6px 20px rgba(38,91,255,0.3)"
                    : "none",
                  opacity: lit || active ? 1 : 0.55,
                }}
              >
                <n.Icon
                  style={{
                    width: 16,
                    height: 16,
                    color: danger
                      ? INK.danger
                      : lit
                        ? "#fff"
                        : INK.faint,
                  }}
                />
                <span
                  style={{
                    ...tc.nodeLbl,
                    color: danger
                      ? INK.danger
                      : lit
                        ? INK.text
                        : INK.faint,
                  }}
                >
                  {n.label}
                </span>
              </div>
              {i < TRACE_NODES.length - 1 && (
                <div style={tc.conn}>
                  <div
                    style={{
                      ...tc.connBase,
                      background:
                        (nodeLit[TRACE_NODES[i + 1]?.id ?? ""] ?? false) &&
                        status !== "idle"
                          ? "var(--idira-blue-500)"
                          : INK.line,
                    }}
                  />
                </div>
              )}
            </Fragment>
          );
        })}
      </div>

      <div style={tc.logHead}>
        <span className="idira-eyebrow" style={{ color: INK.faint }}>
          Identity trace
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            color: INK.faint,
          }}
        >
          {visible.length} events · {ext ? "external carrier" : "internal carrier"}
        </span>
      </div>

      {/* the streaming log */}
      <div ref={logRef} style={tc.log}>
        {status === "idle" && (
          <div style={tc.idle}>
            <span style={{ color: INK.mono }}>$</span> awaiting resolve --
            the trace will stream every identity hop here
          </div>
        )}
        {visible.map((e) => (
          <div
            key={`${e.s}-${e.k}`}
            style={{
              ...tc.row,
              animation: "trcIn 280ms var(--ease-emphasis) both",
            }}
          >
            <span style={tc.ms}>{`+${e.ms}`.padStart(5, " ")}ms</span>
            <span
              style={{
                ...tc.type,
                color:
                  e.tone === "err"
                    ? INK.danger
                    : e.tone === "ok"
                      ? INK.ok
                      : TYPE_COLORS[e.type] ?? INK.mono,
                borderColor:
                  e.tone === "err"
                    ? INK.dangerLine
                    : "rgba(97,134,252,0.3)",
              }}
            >
              {e.type}
            </span>
            <span style={tc.route}>
              <span style={{ color: INK.dim }}>{e.src}</span>
              <ArrowRight
                style={{
                  width: 11,
                  height: 11,
                  color: INK.faint,
                  margin: "0 1px",
                }}
              />
              <span
                style={{
                  color: e.tone === "err" ? INK.danger : INK.mono,
                }}
              >
                {e.dst}
              </span>
            </span>
            <span
              style={{
                ...tc.msg,
                color:
                  e.tone === "err"
                    ? "rgba(255,170,140,0.9)"
                    : e.tone === "ok"
                      ? INK.text
                      : INK.dim,
              }}
            >
              {e.k === "res" && e.tone === "ok" && (
                <Check
                  style={{
                    width: 12,
                    height: 12,
                    color: INK.ok,
                    marginRight: 4,
                    verticalAlign: "-1px",
                  }}
                />
              )}
              {e.msg}
            </span>
          </div>
        ))}
        {status === "running" && (
          <div style={tc.row}>
            <span style={tc.ms}>{"··"}</span>
            <span
              style={{
                ...tc.type,
                color: INK.mono,
                borderColor: "rgba(97,134,252,0.3)",
              }}
            >
              {stage >= 0 ? (SWA.stages[stage]?.key ?? "wait") : "wait"}
            </span>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                color: INK.dim,
              }}
            >
              {stage >= 0
                ? (SWA.stages[stage]?.verb.toLowerCase() ?? "starting")
                : "starting"}
              <span style={tc.cursor}>{"▌"}</span>
            </span>
          </div>
        )}
      </div>

      {/* live token footer */}
      {status === "done" && (
        <div style={tc.tokenFoot}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 6,
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: INK.dim,
              }}
            >
              active JWT-SVID · aud={SWA.jwt.aud}
            </span>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                color: INK.ok,
              }}
            >
              <ShuffleDigits value={fmtTtl(jwtTtl)} /> left
            </span>
          </div>
          <Meter pct={Math.round((jwtTtl / 300) * 100)} active />
        </div>
      )}
      {errored && (
        <div style={tc.errFoot}>
          <ShieldOff style={{ width: 13, height: 13 }} />
          handshake failed at the trust boundary -- no token, no secret, no
          data on the wire
        </div>
      )}
    </div>
  );
}

const tc = {
  root: {
    height: "100%",
    display: "flex",
    flexDirection: "column" as const,
    padding: "22px 30px 26px",
    minHeight: 0,
  },
  strip: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 18,
    flexShrink: 0,
  },
  node: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    gap: 6,
    padding: "11px 6px",
    width: 78,
    borderRadius: "var(--radius-md)",
    border: "1px solid",
    transition: "all 320ms var(--ease-standard)",
  },
  nodeLbl: { fontSize: 10.5, fontWeight: 600, letterSpacing: "0.01em" },
  conn: {
    flex: 1,
    height: 2,
    margin: "0 4px",
    position: "relative" as const,
  },
  connBase: {
    position: "absolute" as const,
    inset: 0,
    borderRadius: 2,
    transition: "background 300ms",
  },
  logHead: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    paddingBottom: 9,
    borderBottom: "1px solid rgba(255,255,255,0.07)",
    flexShrink: 0,
  },
  log: {
    flex: 1,
    overflowY: "auto" as const,
    paddingTop: 8,
    display: "flex",
    flexDirection: "column" as const,
    gap: 2,
    minHeight: 0,
  },
  idle: {
    fontFamily: "var(--font-mono)",
    fontSize: 12.5,
    color: INK.faint,
    padding: "16px 0",
  },
  row: {
    display: "grid",
    gridTemplateColumns: "52px 64px minmax(120px, 200px) 1fr",
    alignItems: "center",
    gap: 12,
    padding: "7px 8px",
    borderRadius: 6,
  },
  ms: {
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    color: INK.faint,
    textAlign: "right" as const,
    whiteSpace: "pre" as const,
  },
  type: {
    fontFamily: "var(--font-mono)",
    fontSize: 9.5,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    fontWeight: 600,
    textAlign: "center" as const,
    padding: "3px 0",
    border: "1px solid",
    borderRadius: 5,
  },
  route: {
    display: "flex",
    alignItems: "center",
    gap: 3,
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    overflow: "hidden",
    whiteSpace: "nowrap" as const,
  },
  msg: {
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    lineHeight: 1.4,
  },
  cursor: {
    animation: "trcBlink 1s steps(1) infinite",
    color: INK.mono,
    marginLeft: 2,
  },
  tokenFoot: {
    flexShrink: 0,
    marginTop: 12,
    padding: "12px 14px",
    border: "1px solid rgba(97,134,252,0.3)",
    borderRadius: "var(--radius-md)",
    background: "rgba(38,91,255,0.06)",
  },
  errFoot: {
    flexShrink: 0,
    marginTop: 12,
    padding: "12px 14px",
    border: `1.5px dashed ${INK.dangerLine}`,
    borderRadius: "var(--radius-md)",
    background: "rgba(250,88,45,0.07)",
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontFamily: "var(--font-mono)",
    fontSize: 11.5,
    color: "rgba(255,180,150,0.9)",
  },
};
