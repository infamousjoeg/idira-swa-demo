// RouteStrip -- origin-to-destination route visualization from portal.jsx.
// Shows origin city, a connecting line with ship icon, and destination city.
import { Ship } from "lucide-react";

/** "2026-06-09T14:00:00Z" -> "Jun 9, 14:00 UTC" */
function formatEta(raw: string): string {
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  const mon = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const day = d.getUTCDate();
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${mon} ${day}, ${hh}:${mm} UTC`;
}

interface RouteStripProps {
  origin: string;
  dest: string;
  eta: string;
}

const styles = {
  route: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: "16px 18px",
    background: "var(--surface-sunken)",
    borderRadius: "var(--radius-lg)",
    border: "1px solid var(--border-subtle)",
  },
  routeEnd: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 2,
    minWidth: 84,
  },
  routeCity: {
    fontSize: 15,
    fontWeight: 700,
    color: "var(--text-strong)",
    fontFamily: "var(--font-display)",
  },
  routeLbl: {
    fontSize: 10.5,
    color: "var(--text-subtle)",
    letterSpacing: "0.04em",
    textTransform: "uppercase" as const,
  },
  routeLine: {
    position: "relative" as const,
    flex: 1,
    height: 2,
    background: "var(--border-default)",
    borderRadius: 2,
  },
  routeDot: {
    position: "absolute" as const,
    top: "50%",
    transform: "translateY(-50%)",
    width: 8,
    height: 8,
    borderRadius: 999,
    background: "var(--neutral-400)",
  },
  routePlane: {
    position: "absolute" as const,
    top: "50%",
    left: "50%",
    transform: "translate(-50%,-50%)",
    width: 30,
    height: 30,
    borderRadius: 999,
    background: "var(--surface-card)",
    border: "1px solid var(--border-default)",
    display: "grid" as const,
    placeItems: "center" as const,
    color: "var(--brand)",
  },
};

export function RouteStrip({ origin, dest, eta }: RouteStripProps) {
  return (
    <div style={styles.route}>
      <div style={styles.routeEnd}>
        <span style={styles.routeCity}>{origin}</span>
        <span style={styles.routeLbl}>Origin</span>
      </div>
      <div style={styles.routeLine}>
        <span style={{ ...styles.routeDot, left: 0 }} />
        <span style={styles.routePlane}>
          <Ship size={16} />
        </span>
        <span style={{ ...styles.routeDot, right: 0, background: "var(--brand)" }} />
      </div>
      <div style={{ ...styles.routeEnd, alignItems: "flex-end", textAlign: "right" as const }}>
        <span style={styles.routeCity}>{dest}</span>
        <span style={styles.routeLbl}>{eta ? `ETA ${formatEta(eta)}` : ""}</span>
      </div>
    </div>
  );
}
