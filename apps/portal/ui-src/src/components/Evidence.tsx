// Evidence -- trust evidence (success) or trust boundary (error) callout.
// Renders SWA.evidence copy verbatim. The validator greps the rendered DOM
// for each lead and body string.
import { ShieldCheck, ShieldAlert } from "lucide-react";
import { SWA } from "../engine/swa";

interface EvidenceProps {
  kind: "success" | "error";
}

const styles = {
  evidence: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 13,
    padding: "16px 18px",
    borderRadius: "var(--radius-lg)",
    borderLeft: "3px solid",
  },
  evidenceHead: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  evidenceList: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 12,
  },
  evidenceItem: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 2,
  },
  evidenceLead: {
    fontSize: 13,
    color: "var(--text-strong)",
    fontWeight: 700,
  },
  evidenceBody: {
    fontSize: 12.5,
    color: "var(--text-muted)",
    lineHeight: 1.5,
  },
};

export function Evidence({ kind }: EvidenceProps) {
  const items = kind === "error" ? SWA.evidence.error : SWA.evidence.success;
  const accent = kind === "error" ? "var(--status-danger)" : "var(--brand)";
  const bg = kind === "error" ? "rgba(200,71,39,0.06)" : "var(--surface-brand-tint)";
  const Icon = kind === "error" ? ShieldAlert : ShieldCheck;

  return (
    <div style={{ ...styles.evidence, borderColor: accent, background: bg, border: `1px solid ${accent}` }}>
      <div style={{ ...styles.evidenceHead, color: accent }}>
        <Icon size={15} />
        <span className="idira-eyebrow" style={{ color: accent }}>
          {kind === "error" ? "Trust boundary" : "Trust evidence"}
        </span>
      </div>
      <div style={styles.evidenceList}>
        {items.map((it, i) => (
          <div key={i} style={styles.evidenceItem}>
            <strong style={styles.evidenceLead}>{it.lead}</strong>
            <span style={styles.evidenceBody}>{it.body}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
