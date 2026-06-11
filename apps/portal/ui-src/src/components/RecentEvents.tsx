// RecentEvents -- compact timestamped activity log under the manifest.
// Mirrors the "recent activity" / "shipment milestones" pattern in real
// freight platforms. Static demo data lives in SWA.shipment.events.
export interface ShipmentEvent {
  ts: string;    // mono-rendered timestamp string (e.g. "Jun 6 14:30 UTC")
  text: string;  // sentence-case event description
  place: string; // location, rendered after a separator
}

export function RecentEvents({ events }: { events: readonly ShipmentEvent[] }) {
  if (!events.length) return null;
  return (
    <section style={re.root} aria-label="Recent shipment events">
      <span className="idira-eyebrow" style={re.eyebrow}>
        Recent activity
      </span>
      <ul style={re.list}>
        {events.map((e, i) => (
          <li key={i} style={re.row}>
            <span style={re.ts}>{e.ts}</span>
            <span style={re.dot} aria-hidden="true" />
            <span style={re.text}>
              {e.text}
              <span style={re.place}> &middot; {e.place}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const re = {
  root: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 8,
  },
  eyebrow: { color: "var(--text-muted)" },
  list: {
    listStyle: "none" as const,
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column" as const,
    gap: 6,
  },
  row: {
    display: "flex",
    alignItems: "baseline",
    gap: 10,
    fontSize: 12.5,
    lineHeight: 1.4,
  },
  ts: {
    fontFamily: "var(--font-mono)",
    fontSize: 11.5,
    color: "var(--text-muted)",
    flexShrink: 0,
    minWidth: 110,
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 999,
    background: "var(--brand)",
    flexShrink: 0,
    alignSelf: "center" as const,
  },
  text: {
    color: "var(--text-body)",
  },
  place: {
    color: "var(--text-subtle)",
  },
};
