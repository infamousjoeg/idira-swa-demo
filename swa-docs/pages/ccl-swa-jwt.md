---
source: https://docs.cyberark.com/early-release/swa/en/content/conjurcloud/ccl-swa-jwt.htm
title: Configure JWT requirements for SWA integrations
---

# Configure JWT requirements for SWA integrations

This topic describes the JWT signing and audience requirements that apply when you use Secure Workload Access (SWA) for secret retrieval and external platform federation.

Use this topic to review supported signing algorithms before you configure Kubernetes secret retrieval or an integration. Use the audience values in this topic for external platform federation.

## Check the supported signing algorithms

Match the Secure Workload Access (SWA) JWT signing settings to the target integration. New trust domains default to RSA JWT signing; you can configure other combinations on the trust domain.

### Trust domain JWT fields

The trust domain API exposes the following JWT signing parameters.

| Parameter | Default | Allowed values |
| --- | --- | --- |
| `signing_key_type` | `RSA_4096` | `EC_P256`, `EC_P384`, `EC_P521`, `RSA_2048`, `RSA_4096` |
| `signature_algorithm` | `RS512` | `ES256`, `ES384`, `ES512`, `RS256`, `RS384`, `RS512` |

### Pair EC and RSA algorithms

Use a signature algorithm from the same key family as `signing_key_type`.

Use `ES*` algorithms with `EC_P*` key types and `RS*` algorithms with `RSA_*` key types. For example, use `ES256` with `EC_P256`, or `RS512` with `RSA_4096`. The table above lists the allowed values for each field.

For API field semantics, see [Register a trust domain](https://docs.cyberark.com/early-release/swa/en/content/conjurcloud/apis/ccl-api-swa-create-trust-domain.htm). For a request example that sets these values explicitly, see [Get started with SWA on Kubernetes](ccl-swa-getstarted-k8.md).

### Integration requirements

For external platform federation, JWTs can use RSA or elliptic-curve signing when the workload JWT issued by the trust domain matches what the target platform configuration expects (issuer, signing algorithm, and related settings).

- AWS OIDC federation: Align the JWT with your AWS IAM OIDC identity provider and role trust policy.
- Azure federated identity: Align the JWT with your Microsoft Entra federated credential settings.
- Secrets Manager JWT authentication: SWA issues JWT-SVID identities on the trust domain.

  You configure elliptic-curve or RSA signing through `jwt.signature_algorithm` and `signing_key_type`. You pair `ES*` with `EC_P*` and `RS*` with `RSA_*` as shown in the table above. New trust domains default to `RS512` with `RSA_4096` for JWT-SVID flows such as Kubernetes secret retrieval.

  The Secrets Manager JWT authenticator accepts RSA-signed JWTs only (`RS*` with `RSA_*`). You must keep RSA signing for authentication on this path.

  Elliptic-curve signing remains supported on the trust domain for other integrations, such as external platform federation in the bullets above.

## Use the required audience value

Use the audience value that matches your Secure Workload Access (SWA) integration target.

For external platform federation, request the JWT with the audience that the target integration expects.

- AWS: Use `sts.amazonaws.com`.
- Azure: Use `api://AzureADTokenExchange`.

## Next steps

Use these links to continue your Secure Workload Access (SWA) integration workflow.

For Kubernetes secret retrieval, continue with [Get started with SWA on Kubernetes](ccl-swa-getstarted-k8.md).

For external platform federation, see [Integrate external platforms](https://docs.cyberark.com/early-release/swa/en/content/conjurcloud/ccl-cloud-platforms-lp.htm) and follow the provider-specific procedure for your external platform.

For complete SWA federation with Secrets Manager JWT authentication, see [Integrate SWA with Secrets Manager JWT authentication](cjr-authn-jwt-swa.md).

For Secrets Manager JWT authentication guidance, see [Important guidelines for configuring JWT authentication](https://docs.cyberark.com/early-release/swa/en/content/operations/services/cjr-authn-jwt-guidelines.htm).
