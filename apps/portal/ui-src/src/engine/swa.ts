// swa.ts -- static demo data + copy from the handoff prototype (engine.jsx).
// Trust context, SPIFFE IDs, evidence copy. Strings are verbatim; the
// validator greps the rendered DOM for each lead/body.

export const SWA = {
  trust: {
    domain: "idira.demo",
    serverGroup: "kind-sg",
    nodeGroup: "kind-ng",
    attestor: "k8s_psat",
  },
  spiffe: {
    portal: "spiffe://idira.demo/kind-ng/ns/swa-demo/sa/portal",
    carrier: "spiffe://idira.demo/kind-ng/ns/swa-demo/sa/carrier",
    foreign: "spiffe://acme.courier/carrier/parcel",
  },
  cipher: "TLS_AES_128_GCM_SHA256",
  jwt: { aud: "conjur", alg: "RS512", kid: "b28ff935...", ttlSec: 300 },
  secret: { variable: "swa-demo/carrier/api-key", bytes: 32 },
  shipment: {
    id: "SHP-2049-883",
    origin: "Singapore",
    destination: "Long Beach",
    eta: "2026-06-09T14:00:00Z",
    carrierName: "Praetor Logistics",
    weight: "18,400 kg",
    mode: "Ocean - FCL",
    container: "PRLU-774203-1",
    // Container detail micro-line under the Container manifest row.
    containerDetail: "40' HC - Maersk Line - Seal MAEU-8830124",
    // Recent activity log, static demo content. Render order is top-to-bottom
    // chronological (newest first). Timestamps in mono.
    events: [
      {
        ts: "Jun 11 06:12 UTC",
        text: "Vessel position update",
        place: "East China Sea, 28.4N 124.1E",
      },
      {
        ts: "Jun 6 14:30 UTC",
        text: "Loaded on vessel",
        place: "Singapore PSA Terminal 4",
      },
      {
        ts: "Jun 5 08:05 UTC",
        text: "Gate-in at port",
        place: "Singapore PSA Terminal 4",
      },
    ],
  },

  // The six animated stages of a successful resolve.
  stages: [
    {
      key: "attest",
      n: 1,
      label: "Node attestation",
      verb: "Attesting node",
      from: "anchor",
      to: "portal",
      detail: "k8s_psat - kind-ng",
      line: "agent attested by k8s_psat - X.509-SVIDs issued to portal + carrier",
    },
    {
      key: "mtls",
      n: 2,
      label: "Mutual TLS",
      verb: "Opening mTLS",
      from: "portal",
      to: "carrier",
      detail: "TLS_AES_128_GCM_SHA256",
      line: "portal <-> carrier - each peer verified by exact SPIFFE ID",
    },
    {
      key: "jwt",
      n: 3,
      label: "JWT-SVID issued",
      verb: "Requesting JWT-SVID",
      from: "carrier",
      to: "agent",
      detail: "aud=conjur - RS512",
      line: "carrier -> agent workload API - JWT-SVID minted, ttl 5m",
    },
    {
      key: "authn",
      n: 4,
      label: "Token granted",
      verb: "Exchanging at Secrets Manager",
      from: "carrier",
      to: "sm",
      detail: "POST /authn-jwt",
      line: "JWT verified against trust-domain JWKS - access token granted",
    },
    {
      key: "fetch",
      n: 5,
      label: "Secret returned",
      verb: "Fetching secret",
      from: "sm",
      to: "carrier",
      detail: "GET swa-demo/carrier/api-key",
      line: "32 bytes - held in process for one request - never on disk",
    },
    {
      key: "resolve",
      n: 6,
      label: "Shipment resolved",
      verb: "Resolving shipment",
      from: "carrier",
      to: "portal",
      detail: "200 - manifest returned",
      line: "carrier used the key in memory - shipment manifest returned to portal",
    },
  ],

  // Copy for the left-pane trust-evidence callout.
  evidence: {
    success: [
      {
        lead: "Cryptographic identity, not a key.",
        body: "This carrier proved who it is with a short-lived X.509 certificate issued by your trust domain -- not a static API key baked into config.",
      },
      {
        lead: "The secret never landed.",
        body: "It lived in the carrier's memory for one HTTP request, then was discarded. No env var, no mounted file, no copy on disk.",
      },
      {
        lead: "Scoped to exactly one variable.",
        body: "Policy on the Secrets Manager side denies access to everything except swa-demo/carrier/api-key.",
      },
    ],
    error: [
      {
        lead: "Signed by a CA your trust domain doesn't know.",
        body: "The external carrier presented a valid certificate -- just from a foreign trust domain. No federation is configured, so the trust roots don't anchor it.",
      },
      {
        lead: "Rejected before any data moved.",
        body: "No JWT-SVID was issued, no Secrets Manager call was made, no secret was fetched. The mTLS handshake failed at the door.",
      },
      {
        lead: "This is the boundary working.",
        body: "acme.courier still has its own identity -- your trust roots simply do not anchor it. SWA trust-domain federation would resolve this; not yet available.",
      },
    ],
  },
} as const;

export type Stage = (typeof SWA.stages)[number];
export type EvidenceItem = { lead: string; body: string };
