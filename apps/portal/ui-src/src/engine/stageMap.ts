// stageMap.ts -- maps SSE event types to stage indices for the six-stage
// resolve sequence. Both the happy path (internal carrier) and the failure
// path (external carrier, mTLS rejected at stage 2) are covered.

/** Maps an SSE event type string to its stage index (0-based) in
 *  SWA.stages. Returns -1 for events that don't correspond to a stage. */
export function eventToStage(eventType: string): number {
  switch (eventType) {
    case "portal.resolve.requested":
      return 0; // attest
    case "mtls.handshake.start":
      return 1; // mtls
    case "mtls.peer_uri_seen":
      return 1; // still mtls stage (primes foreign-TD info)
    case "mtls.handshake.ok":
      return 1; // mtls complete
    case "jwt_svid.issued":
      return 2; // jwt
    case "sm.authn_jwt.ok":
      return 3; // authn
    case "sm.secret_fetched.ok":
      return 4; // fetch
    case "portal.resolve.ok":
      return 5; // resolve complete
    // Error events
    case "mtls.handshake.err":
    case "mtls.handshake.error":
      return 1; // fails at mtls stage
    default:
      return -1;
  }
}

/** Human-readable verb for the currently active stage, shown on the
 *  Resolve button while running. */
export function stageVerb(stageIndex: number): string {
  switch (stageIndex) {
    case 0:
      return "Attesting node...";
    case 1:
      return "Opening mTLS...";
    case 2:
      return "Requesting JWT-SVID...";
    case 3:
      return "Exchanging at Secrets Manager...";
    case 4:
      return "Fetching secret...";
    case 5:
      return "Resolving shipment...";
    default:
      return "Resolving...";
  }
}

/** Returns true if the event type signals an error terminal state. */
export function isErrorEvent(eventType: string): boolean {
  return /\.err$|\.error$|\.empty$/.test(eventType);
}

