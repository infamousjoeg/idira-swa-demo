// App -- wires the PortalPane (left) and InspectorChrome + visualizations
// (right) to the resolve engine, pace controls, and view/pace DarkSeg
// controls. M-UI4: keyboard accessibility + foreign-trust URI passthrough.
import { useState, useCallback, useEffect, useMemo } from "react";
import { GitFork, Layers, Terminal } from "lucide-react";
import { PortalPane } from "./components/PortalPane";
import { DarkSeg } from "./components/DarkSeg";
import { InspectorChrome } from "./components/InspectorChrome";
import { AccessibilityHints } from "./components/AccessibilityHints";
import { TopologyInspector } from "./visualizations/TopologyInspector";
import { LayersInspector } from "./visualizations/LayersInspector";
import { TraceInspector } from "./visualizations/TraceInspector";
import { useResolveEngine } from "./engine/useResolveEngine";
import * as paceQueue from "./engine/paceQueue";

type ViewMode = "topology" | "layers" | "trace";
type PaceMode = "off" | "fast" | "medium" | "slow";

const VIEW_OPTIONS: { v: ViewMode; label: string; icon: React.ReactNode }[] = [
  { v: "topology", label: "Topo", icon: <GitFork style={{ width: 13, height: 13 }} /> },
  { v: "layers", label: "Layers", icon: <Layers style={{ width: 13, height: 13 }} /> },
  { v: "trace", label: "Trace", icon: <Terminal style={{ width: 13, height: 13 }} /> },
];

const PACE_OPTIONS: { v: PaceMode; label: string }[] = [
  { v: "off", label: "Off" },
  { v: "fast", label: "Fast" },
  { v: "medium", label: "Med" },
  { v: "slow", label: "Slow" },
];

export function App() {
  const [shipmentId, setShipmentId] = useState("SHP-2049-883");
  const [carrier, setCarrier] = useState<"internal" | "external">("internal");
  const [view, setView] = useState<ViewMode>("topology");
  const [pace, setPace] = useState<PaceMode>("medium");
  const engine = useResolveEngine();

  // Wire pace state to the paceQueue module.
  useEffect(() => {
    paceQueue.setPace(pace);
  }, [pace]);

  // Carrier toggle resets the engine (spec: reset() called on carrier change).
  const handleCarrierChange = useCallback(
    (v: "internal" | "external") => {
      setCarrier(v);
      engine.reset();
    },
    [engine],
  );

  const handleResolve = useCallback(() => {
    engine.run(carrier, shipmentId);
  }, [engine, carrier, shipmentId]);

  const handleReset = useCallback(() => {
    engine.reset();
  }, [engine]);

  // DarkSeg controls rendered in the InspectorChrome header.
  const inspectorControls = useMemo(
    () => (
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <DarkSeg<ViewMode>
          value={view}
          onChange={setView}
          options={VIEW_OPTIONS}
        />
        <DarkSeg<PaceMode>
          value={pace}
          onChange={setPace}
          options={PACE_OPTIONS}
          label="Pace"
        />
      </div>
    ),
    [view, pace],
  );

  // Real foreign peer URI captured from mtls.peer_uri_seen on the error path.
  // Passed to visualizations so Topology shows the actual URI, not hardcoded.
  const foreignPeerUri =
    engine.error?.payload?.uri != null
      ? String(engine.error.payload.uri)
      : undefined;

  // Shared props for all three visualizations.
  const vizProps = {
    status: engine.status,
    stage: engine.stage,
    completed: engine.completed,
    carrier,
    jwtTtl: engine.jwtTtl,
    foreignPeerUri,
  } as const;

  return (
    <div
      data-motion="cinematic"
      style={{
        display: "flex",
        height: "100vh",
        width: "100vw",
        overflow: "hidden",
      }}
    >
      <AccessibilityHints onReset={handleReset} targetId="main-content" />

      {/* Left pane: portal (44%) */}
      <div
        id="main-content"
        style={{
          flex: "0 0 44%",
          minWidth: 440,
          maxWidth: 640,
          height: "100%",
        }}
      >
        <PortalPane
          carrier={carrier}
          setCarrier={handleCarrierChange}
          status={engine.status}
          stageVerb={engine.stageVerb}
          shipmentId={shipmentId}
          setShipmentId={setShipmentId}
          onResolve={handleResolve}
          result={engine.result}
          error={engine.error}
        />
      </div>

      {/* Right pane: inspector (flex 1) */}
      <div style={{ flex: 1, minWidth: 0, height: "100%" }}>
        <InspectorChrome
          status={engine.status}
          stage={engine.stage}
          shimmer
          controls={inspectorControls}
          onReset={handleReset}
        >
          {view === "topology" && <TopologyInspector {...vizProps} />}
          {view === "layers" && <LayersInspector {...vizProps} />}
          {view === "trace" && <TraceInspector {...vizProps} />}
        </InspectorChrome>
      </div>
    </div>
  );
}
