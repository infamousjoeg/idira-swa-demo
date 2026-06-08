# acme-carrier

A deliberately-not-SWA carrier service used by M7 of the Idira SWA demo to
illustrate trust-domain boundary rejection.

Generates a self-signed CA and leaf at startup. The leaf's SAN URI is
`spiffe://acme.courier/carrier/parcel` -- a different trust domain from the
demo's `idira.demo`. Serves mTLS on `:8443`. Accepts any client cert
(`tls.RequireAnyClientCert`) because the demo tests the *portal's* rejection
direction, not Acme's.

In the happy demo flow the `/lookup/{id}` handler is never reached, because
the portal's verifier rejects the chain before TLS completes. The handler
exists so the binary compiles and so a `curl --insecure` from inside the
cluster can prove the service is up during development.
