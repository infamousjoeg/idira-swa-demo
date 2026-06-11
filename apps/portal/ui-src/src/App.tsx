// App -- wires the PortalPane to the resolve engine and pace controls.
// M-UI2: left pane only. M-UI3 adds the inspector (right pane).
import { useState, useCallback, useEffect } from "react";
import { PortalPane } from "./components/PortalPane";
import { useResolveEngine } from "./engine/useResolveEngine";
import * as paceQueue from "./engine/paceQueue";

export function App() {
  const [shipmentId, setShipmentId] = useState("SHP-2049-883");
  const [carrier, setCarrier] = useState<"internal" | "external">("internal");
  const engine = useResolveEngine();

  // Default pace is medium. M-UI3 will add a UI control for this.
  useEffect(() => {
    paceQueue.setPace("medium");
  }, []);

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

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        width: "100vw",
        overflow: "hidden",
      }}
    >
      {/* Left pane: portal */}
      <div style={{ flex: 1, minWidth: 0, height: "100%" }}>
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

      {/* Right pane: inspector placeholder (M-UI3 scope) */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          height: "100%",
          background:
            "radial-gradient(120% 90% at 80% 0%, #0E2A78 0%, #061D63 38%, #050F38 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "rgba(196,210,250,0.62)",
          fontFamily: "var(--font-mono)",
          fontSize: 13,
        }}
      >
        Inspector (M-UI3)
      </div>
    </div>
  );
}
