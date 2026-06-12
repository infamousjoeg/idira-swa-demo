// PraetorMark -- original geometric mark for the fictional Praetor Logistics.
// Verbatim from the handoff portal.jsx.

interface PraetorMarkProps {
  size?: number;
}

export function PraetorMark({ size = 26 }: PraetorMarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="28" height="28" rx="7" fill="#0B1020" />
      <path d="M10 22V10h6.2c2.7 0 4.3 1.5 4.3 3.9 0 2.4-1.6 3.9-4.3 3.9H13" stroke="#FF724D" strokeWidth="2.1" strokeLinecap="square" />
      <circle cx="22" cy="22" r="1.7" fill="#FF724D" />
    </svg>
  );
}
