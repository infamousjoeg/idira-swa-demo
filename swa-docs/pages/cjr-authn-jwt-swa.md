---
source: https://docs.cyberark.com/early-release/swa/en/content/operations/services/cjr-authn-jwt-swa.htm
title: Integrate SWA with Secrets Manager JWT authentication
---

# Integrate SWA with Secrets Manager JWT authentication

This topic describes how to configure federation between Secure Workload Access (SWA) and Secrets Manager by using the JWT authenticator.

After you complete this workflow, a workload can fetch a JWT-SVID from SWA, authenticate to Secrets Manager, and retrieve authorized secrets.

## Before you begin

- Complete Secure Workload Access (SWA) setup and make sure workloads can fetch JWT-SVIDs. For more information, see [Get started with SWA on Kubernetes](ccl-swa-getstarted-k8.md).
- Confirm OIDC issuer values. For more information, see [Configure OIDC issuer values for SWA integrations](ccl-swa-oidc.md).
- You must confirm JWT signing and audience requirements when you integrate SWA with Secrets Manager JWT authentication. SWA can issue JWT-SVIDs with RSA or elliptic-curve signing on the trust domain. You must use RSA signing (`RS*` with `RSA_*`) with the JWT authenticator. Elliptic-curve signing is not supported on that path. For more information, see [Configure JWT requirements for SWA integrations](ccl-swa-jwt.md).
- Use an account with permissions to manage policies, authenticators, and secrets in Secrets Manager.
- Make sure the following tools are available on the host where you run the commands: the Secrets Manager CLI, `curl`, `jq`, and the `swa-agent` binary installed at `/opt/swa/bin/swa-agent`.

> **Note:**
>
> When SWA attests a workload, it creates a workload host identity under `data/swa/trust-domains/<trust-domain>/workloads/`. SWA does not create the `workloads` group. New workload identities have no secret access by default.
>
> You must create the `workloads` group, annotate the workload host with its SPIFFE ID so the JWT authenticator can map the `sub` claim, grant the host membership in the group, and grant secret permissions before the workload can retrieve secrets.

![Authorize workload diagram](https://docs.cyberark.com/early-release/swa/en/content/images/conjurcloud/swa-authorize-workload.png)

## Configure and load the JWT authenticator policy

Create a JWT authenticator policy for SWA. The policy defines the JWT authenticator webservice, declares the configuration variables, and sets up groups for workload and operator access.

```
- !policy
  id: secureWorkloadAccess
  body:
  - !webservice
    annotations:
      description: JWT authenticator for SWA

  - !variable
    id: jwks-uri

  - !variable
    id: token-app-property

  - !variable
    id: identity-path

  - !variable
    id: issuer

  - !variable
    id: audience

  - !group
    id: apps

  - !permit
    role: !group apps
    privilege: [ read, authenticate ]
    resource: !webservice

  - !webservice status

  - !group
    id: operators

  - !permit
    role: !group operators
    privilege: [ read ]
    resource: !webservice status
```

Save the policy as `jwt-authenticator.yaml`, then load it in the `conjur/authn-jwt` branch:

```
conjur policy load -b conjur/authn-jwt -f jwt-authenticator.yaml
```

## Set JWT authenticator variables

Set the required variables for the `secureWorkloadAccess` JWT authenticator.

The OIDC discovery document uses the key `jwks_uri` (with an underscore). The corresponding Secrets Manager variable ID is `jwks-uri` (with a hyphen).

For SWA, the issuer identifier and JWKS URI are scoped to the trust domain. They follow the pattern `https://<tenant>.secretsmgr.cyberark.cloud/api/swa/trust-domains/<trust-domain>`. Append `/.well-known/jwks` for the JWKS URI. The issuer value is the trust domain base URL, not the OIDC discovery document URL.

| Variable | Description |
| --- | --- |
| `jwks-uri` | Set to the SWA JWKS URL for your trust domain. For Kubernetes, you can read `jwks_uri` from OIDC discovery (see [Get started with SWA on Kubernetes](ccl-swa-getstarted-k8.md)). |
| `token-app-property` | Set to `sub` when the JWT subject claim identifies the workload (SPIFFE ID). |
| `identity-path` | Set to `data/swa/trust-domains/<trust-domain>/workloads`, the branch where SWA registers workload identities. Replace `<trust-domain>` with your SWA trust domain name. |
| `issuer` | Set to the SWA OIDC issuer URL for your trust domain (trust domain base URL). For Kubernetes, you can read `issuer` from OIDC discovery (see [Get started with SWA on Kubernetes](ccl-swa-getstarted-k8.md)). |
| `audience` | Set to `conjur` so it matches the JWT `aud` claim. If you use a different value in the SWA Server Helm chart for `controlPlane.auth.audience`, set this variable to that same value. |

Run the following commands to set the variables:

```
# JWKS URI — SWA publishes per-trust-domain JWKS at this path
conjur variable set -i conjur/authn-jwt/secureWorkloadAccess/jwks-uri -v "https://<tenant>.secretsmgr.cyberark.cloud/api/swa/trust-domains/<trust-domain>/.well-known/jwks"

# JWT claim used as the application identity (SPIFFE ID)
conjur variable set -i conjur/authn-jwt/secureWorkloadAccess/token-app-property -v "sub"

# Branch where SWA registers workload identities — must match your trust domain
conjur variable set -i conjur/authn-jwt/secureWorkloadAccess/identity-path -v "data/swa/trust-domains/<trust-domain>/workloads"

# Issuer — SWA OIDC issuer is scoped per trust domain
conjur variable set -i conjur/authn-jwt/secureWorkloadAccess/issuer -v "https://<tenant>.secretsmgr.cyberark.cloud/api/swa/trust-domains/<trust-domain>"

# Audience — must match the value configured in the SWA Server Helm chart (controlPlane.auth.audience)
conjur variable set -i conjur/authn-jwt/secureWorkloadAccess/audience -v "conjur"
```

## Enable the JWT authenticator

Enable the `authn-jwt/secureWorkloadAccess` authenticator.

```
conjur authenticator enable --id authn-jwt/secureWorkloadAccess
```

## Register the workload identity and grant authenticator access

SWA creates workload host identities under `data/swa/trust-domains/<trust-domain>/workloads/` but does not create the `workloads` group. You must create the group, annotate the workload host with its SPIFFE ID so the JWT authenticator can map the `sub` claim, and grant the host membership in the group.

Replace `<trust-domain>` with your SWA trust domain name and `<spiffe-id>` with the full SPIFFE ID of the workload as issued by SWA (for example, `spiffe://example.org/default-nodegroup/ns/my-namespace/sa/my-service-account`). When SWA attests a workload, it creates the workload identity in Secrets Manager using the SPIFFE ID as its name.

Save the following policy as `workloads-group.yaml`:

```
- !group
  id: workloads

- !host
  id: workloads/<spiffe-id>
  annotations:
    authn-jwt/secureWorkloadAccess/sub: <spiffe-id>

- !grant
  role: !group workloads
  member: !host workloads/<spiffe-id>
```

Load the policy in the trust domain branch:

```
conjur policy load -b data/swa/trust-domains/<trust-domain> -f workloads-group.yaml
```

> **Note:**
>
> The annotation key must be `authn-jwt/secureWorkloadAccess/sub`. The annotation value must match the JWT `sub` claim (SPIFFE ID). If you rename the authenticator policy `id` in the first section, update the annotation prefix and all `conjur/authn-jwt/<id>/...` paths consistently.

Save the following policy as `authn-jwt-grant.yaml`, then load it to grant the `workloads` group access to the JWT authenticator service:

```
- !grant
  role: !group apps
  member: !group /data/swa/trust-domains/<trust-domain>/workloads
```

```
conjur policy load -f authn-jwt-grant.yaml -b conjur/authn-jwt/secureWorkloadAccess
```

## Create secrets and grant workload permissions

Create a secret policy and grant the workload identity permissions to access secrets.

The host path uses an absolute reference (leading `/`) so it resolves to the identity that SWA creates in the `data` branch, regardless of which branch you load this policy into.

```
- !policy
  id: swa/secrets
  body:
  - !policy
    id: myapp
    body:
    - !variable
      id: api-key

    - !permit
      role: !host /data/swa/trust-domains/<trust-domain>/workloads/<spiffe-id>
      privilege: [ read, execute ]
      resource: !variable api-key
```

Save the policy as `secrets-and-permissions.yaml`, then load it and set the secret value:

```
conjur policy load -b data -f secrets-and-permissions.yaml
conjur variable set -i data/swa/secrets/myapp/api-key -v "sk-1234567890abcdef"
```

## Test token exchange

Fetch a JWT-SVID from SWA, authenticate to Secrets Manager, and retrieve a secret.

Fetch the JWT-SVID from the SWA agent:

```
JWT_TOKEN=$(/opt/swa/bin/swa-agent api fetch jwt \
  --audience conjur \
  --output json \
  --socketPath /run/swa-agent/api.sock | jq -r '.[].svids[]?.svid')
```

Authenticate to Secrets Manager and retrieve a secret:

```
CONJUR_ACCESS_TOKEN=$(curl -s -X POST \
  "https://<subdomain>.secretsmgr.cyberark.cloud/api/authn-jwt/secureWorkloadAccess/conjur/authenticate" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "jwt=$JWT_TOKEN" | base64 | tr -d '\n')

curl -s \
  -H "Authorization: Token token=\"$CONJUR_ACCESS_TOKEN\"" \
  "https://<subdomain>.secretsmgr.cyberark.cloud/api/secrets/conjur/variable/data/swa/secrets/myapp/api-key"
```

## Migrate existing workloads to SPIFFE authentication

If you switch an existing workload from a different authentication method to SWA and SPIFFE, you must manually handle the transition to avoid authentication downtime.

> **Note:**
>
> SWA cannot recognize or migrate existing workload identities that you created with non-SPIFFE authenticators. When SWA attests a workload, it creates a new workload identity with a SPIFFE ID.
>
> Delete the existing workload identity, and then grant permissions to the new SPIFFE-based identity. This change causes a brief service interruption.

To migrate an existing workload:

1. Plan the cutover: Identify when your workload will switch authentication methods.
2. Deploy and start SWA agents on your workload nodes. SWA begins attesting the workload and creates a new identity under `data/swa/trust-domains/<trust-domain>/workloads/<spiffe-id>`.
3. Complete the steps in [Register the workload identity and grant authenticator access](#Register) and [Create secrets and grant workload permissions](#Create) for the new SPIFFE-based identity.
4. Delete the old workload identity from the `data` branch to prevent access conflicts.

   ```
   conjur policy load -b data <<EOF
   - !delete
     resource: !host /<old-path>/<old-workload-id>
   EOF
   ```
5. Update your workload to use SWA for authentication (fetch SVID from the agent, authenticate using JWT, retrieve secrets).
6. Test and verify the workload retrieves secrets successfully with the new SPIFFE identity.

## Next steps

For JWT authenticator behavior and constraints, see [Important guidelines for configuring JWT authentication](https://docs.cyberark.com/early-release/swa/en/content/operations/services/cjr-authn-jwt-guidelines.htm).

For troubleshooting, see [Troubleshoot JWT authentication](https://docs.cyberark.com/early-release/swa/en/content/operations/services/cjr-authn-jwt-ts.htm).
