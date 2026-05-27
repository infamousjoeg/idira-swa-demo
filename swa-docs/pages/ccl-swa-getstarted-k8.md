---
source: https://docs.cyberark.com/early-release/swa/en/content/conjurcloud/ccl-swa-getstarted-k8.htm
title: Get started with SWA on Kubernetes
---

# Get started with SWA on Kubernetes

This topic describes how you set up Secrets Manager Secure Workload Access (SWA) on Kubernetes to manage SPIFFE-based workload identities and fetch secrets from Secrets Manager.

With SWA, workloads are attested and issued a unique SPIFFE Verifiable Identity Document (SVID). Workloads use the SVID to authenticate and retrieve secrets.

## Before you begin

Make sure you meet these requirements before you start:

- An active Secrets Manager tenant
- Secrets Manager Admin role
- Secrets Manager SKU entitlement for Secure Workload Access (SWA) artifacts in the CyberArk Marketplace
- Kubernetes cluster for the SWA Server (v1.33–1.35) for GA
- Kubernetes nodes or RHEL hosts (8.x/9.x) for SWA Agents
- SWA activated for your tenant

> **Note:**
>
> For current regional availability and support scope, see [Secrets Manager support and scope](https://docs.cyberark.com/early-release/swa/en/content/conjurcloud/ccl-support.htm).

## Set up Secure Workload Access

Use this workflow to set up Secure Workload Access (SWA) and enable workloads to fetch secrets.

### Prepare API authentication

Get a Secrets Manager access token and set shell variables before you run SWA API commands.

To prepare API access:

1. Get a Secrets Manager access token for API calls by using an account with the Secrets Manager Admin role. For the full authentication flow, see [Authenticate user](https://docs.cyberark.com/early-release/swa/en/content/developer/conjur_api_authenticate_user.htm).
2. Optional: set these shell variables to reuse values across the commands in this workflow. If you do not use shell variables, replace each variable reference directly in the commands.

   The examples use `SWA_API_BASE` for the tenant host. Set it from your tenant subdomain. The host matches `https://<subdomain>.secretsmgr.cyberark.cloud`.

   ```
   export TENANT_SUBDOMAIN="<subdomain>"
   export SWA_API_BASE="https://${TENANT_SUBDOMAIN}.secretsmgr.cyberark.cloud"
   export TOKEN="<token>"
   export TRUST_DOMAIN_NAME="prod.example"
   export SERVER_GROUP_NAME="k8s-prod"
   export NODE_GROUP_NAME="k8s-prod-ng"
   export SERVER_NAME="swa-server-a"
   ```

### Step 1: Create SWA resources

Create the SPIFFE hierarchy through the API. Resource creation also creates system-managed branches in Secrets Manager, such as `data/swa`.

To manage trust domains, server groups, node groups, and related resources with Terraform instead of the REST API, install the SWA Terraform provider. For details, see [Install the SWA Terraform provider](ccl-swa-terraform-provider.md).

[API conventions for SWA REST calls](#)

> **Note:**
>
> API conventions: Use the SWA API base host `https://<subdomain>.secretsmgr.cyberark.cloud`. SWA endpoints use the `/api/swa` prefix. Authenticate requests with `Authorization: Token token="<access token from authenticate endpoint>"`. Use `Accept: application/x.secretsmgr.v2+json` for v2 APIs. Do not use a Beta header. URL-encode any resource name that appears in a path segment.

> **Note:**
>
> Use the commands in this workflow for a minimal setup path. For complete field definitions, optional parameters, validation rules, and response details, see [Secure Workload Access APIs](https://docs.cyberark.com/early-release/swa/en/content/conjurcloud/apis/ccl-api-swa-lp.htm).
>
> For node group design (attestation, `swa_nodegroup`, identity boundaries), see [Design and assign SWA node groups](ccl-swa-node-groups-design.md). For SPIFFE ID templates, attestors, and workload registration policies, see [SPIFFE templates, attestors, and registration policies for SWA](ccl-swa-node-groups-templates-policies.md).

To create SWA resources:

1. Create a trust domain: Define the root SPIFFE namespace.

   Use this command:

   ```
   curl -sS -X POST "${SWA_API_BASE}/api/swa/trust-domains" \
       -H "Authorization: Token token=\"${TOKEN}\"" \
       -H "Accept: application/x.secretsmgr.v2+json" \
       -H "Content-Type: application/json" \
       -d '{
           "name": "'"${TRUST_DOMAIN_NAME}"'",
           "jwt": {
               "signature_algorithm": "RS512",
               "signing_key_ttl": 86400,
               "signing_key_type": "RSA_4096",
               "token_ttl": 300
           },
           "x509": {
               "workload_ttl": 3600
           }
       }'
   ```

   > **Note:**
   >
   > New trust domains default to RSA JWT signing with `RS512` and `RSA_4096`, which works with Secrets Manager JWT authentication and Secrets Manager - SaaS for JWT-SVID flows. Elliptic-curve signing is also supported on the trust domain. This example sets those values explicitly; you can omit the `jwt` object to use the same defaults. For integration-specific signing requirements, see [Configure JWT requirements for SWA integrations](ccl-swa-jwt.md).

   For all available fields and full response details, see [Register a trust domain](https://docs.cyberark.com/early-release/swa/en/content/conjurcloud/apis/ccl-api-swa-create-trust-domain.htm).

   Save the trust domain `name`. Depending on the final authentication configuration, you might also need `jwt.discovery_endpoints.oidc_discovery_url` and `jwt.discovery_endpoints.jwks_uri` for later steps.
2. Create a server group: Define a logical group for SWA Servers. Use the trust domain `name` from the previous step.

   Use this command:

   ```
   curl -sS -X POST "${SWA_API_BASE}/api/swa/trust-domains/${TRUST_DOMAIN_NAME}/server-groups" \
       -H "Authorization: Token token=\"${TOKEN}\"" \
       -H "Accept: application/x.secretsmgr.v2+json" \
       -H "Content-Type: application/json" \
       -d '{
           "name": "'"${SERVER_GROUP_NAME}"'",
           "description": "Kubernetes manual test server group",
           "node_attestation": {
               "k8s_psat": {
                   "clusters": {
                       "prod-cluster": {
                           "service_account_allow_list": [
                               "swa-system:swa-agent"
                           ],
                           "audience": [
                               "swa-server"
                           ],
                           "allowed_pod_label_keys": [
                               "swa_nodegroup"
                           ]
                       }
                   }
               }
           }
       }'
   ```

   For all available fields and full response details, see [Create a server group](https://docs.cyberark.com/early-release/swa/en/content/conjurcloud/apis/ccl-api-swa-create-server-group.htm).

   Save the server group `name`. You use it when you create node groups and register the SWA Server.
3. Create a node group: Define attestation rules that control which workloads can get an SVID. Use the trust domain and server group `name` values from the previous steps.

   Use this command:

   ```
   curl -sS -X POST "${SWA_API_BASE}/api/swa/trust-domains/${TRUST_DOMAIN_NAME}/server-groups/${SERVER_GROUP_NAME}/node-groups" \
       -H "Authorization: Token token=\"${TOKEN}\"" \
       -H "Accept: application/x.secretsmgr.v2+json" \
       -H "Content-Type: application/json" \
       -d '{
           "name": "'"${NODE_GROUP_NAME}"'",
           "description": "Kubernetes production node group",
           "workload_type": "kubernetes"
       }'
   ```

   For all available fields and full response details, see [Create node group](https://docs.cyberark.com/early-release/swa/en/content/conjurcloud/apis/ccl-api-swa-create-node-group.htm).

### Step 2: Register the SWA Server

Register the SWA Server to get installation credentials; the request includes JWT authenticator data so Secrets Manager can validate service account tokens from your cluster (for field definitions, see [Create authenticator](https://docs.cyberark.com/early-release/swa/en/content/conjurcloud/apis/ccl-api-create-auth.htm) and [Register an SWA server](https://docs.cyberark.com/early-release/swa/en/content/conjurcloud/apis/ccl-api-swa-register-server.htm)).

SWA uses a Kubernetes service account to authenticate the SWA Server to Secrets Manager - SaaS so the server can retrieve its configuration; this JWT authentication is used only by the SWA Server and not by workloads.

To register a server:

After discovery, complete the step that matches your tenant network path. You register the server once, using either `jwks_uri` or `public_keys`.

1. Discover the Kubernetes API server OpenID configuration from a context that can reach your cluster. Run the following command:

   ```
   kubectl get --raw '/.well-known/openid-configuration'
   ```

   The response is JSON. Save the `issuer` value and the `jwks_uri` value. You use them in the registration request when the JWKS URL is reachable from your Secrets Manager - SaaS tenant, as described in the next step.
2. JWKS URL is reachable from the tenant: Send a `POST` request to register the server. Set `authentication.data` with `issuer` and `jwks_uri`. Do not set `public_keys`.

   Set `issuer` and `jwks_uri` from the discovery output. Your operations team might publish the same issuer and JWKS on publicly routable URLs. If they do, use those URLs so Secrets Manager can reach them.

   Use a request body similar to the following example:

   ```
   curl -sS -X POST "${SWA_API_BASE}/api/swa/trust-domains/${TRUST_DOMAIN_NAME}/server-groups/${SERVER_GROUP_NAME}/components" \
       -H "Authorization: Token token=\"${TOKEN}\"" \
       -H "Accept: application/x.secretsmgr.v2+json" \
       -H "Content-Type: application/json" \
       -d '{
           "name": "'"${SERVER_NAME}"'",
           "authentication": {
               "type": "JWT",
               "data": {
                   "sub": "system:serviceaccount:swa-system:swa-server",
                   "issuer": "'"${ISSUER}"'",
                   "jwks_uri": "'"${JWKS_URI}"'",
                   "audience": "conjur"
               }
           }
       }'
   ```

   Set shell variables `ISSUER` and `JWKS_URI` to the `issuer` and `jwks_uri` values from your discovery output. Those strings are defined by your cluster; do not substitute documentation project variables (for example https://<subdomain>.secretsmgr.cyberark.cloud) for them. Use `conjur` for `audience` so it matches the JWT `aud` claim your Kubernetes service account tokens use for this flow. For details, see [Create authenticator](https://docs.cyberark.com/early-release/swa/en/content/conjurcloud/apis/ccl-api-create-auth.htm).
3. JWKS URL is not reachable from the tenant: Send a `POST` request to register the server. Set `authentication.data` with `issuer` and `public_keys`. Omit `jwks_uri`.

   `issuer` is required when you use `public_keys`. Use the `public_keys` object shape in [Create authenticator](https://docs.cyberark.com/early-release/swa/en/content/conjurcloud/apis/ccl-api-create-auth.htm). Obtain the JWKS JSON from the cluster. For example, run `kubectl get --raw` against the `jwks_uri` path from the discovery document. If `jwks_uri` is a relative path on the API server, pass that path to `kubectl get --raw`.

   Build a JSON file for the request body. The `authentication.data` object should look like the following example. Replace the empty `keys` array with the `keys` array from the JWKS document you obtained with `kubectl get --raw` (the JWKS document is the JSON object whose top-level property is `keys`).

   ```
   {
       "name": "<server-name>",
       "authentication": {
           "type": "JWT",
           "data": {
               "sub": "system:serviceaccount:swa-system:swa-server",
               "issuer": "<issuer from discovery>",
               "audience": "conjur",
               "public_keys": {
                   "type": "jwks",
                   "value": {
                       "keys": []
                   }
               }
           }
       }
   }
   ```

   Send the file with `curl`, for example:

   ```
   curl -sS -X POST "${SWA_API_BASE}/api/swa/trust-domains/${TRUST_DOMAIN_NAME}/server-groups/${SERVER_GROUP_NAME}/components" \
       -H "Authorization: Token token=\"${TOKEN}\"" \
       -H "Accept: application/x.secretsmgr.v2+json" \
       -H "Content-Type: application/json" \
       -d @register-swa-server.json
   ```

   For a complete `public_keys` example, see [Create authenticator](https://docs.cyberark.com/early-release/swa/en/content/conjurcloud/apis/ccl-api-create-auth.htm).

For advanced JWT authenticator fields and full response details, see [Register an SWA server](https://docs.cyberark.com/early-release/swa/en/content/conjurcloud/apis/ccl-api-swa-register-server.htm).

1. Save the `authn_id` value from the response. Use it when you install the SWA Server.

### Step 3: Install SWA components

Install the SWA Server and SWA Agents using supported deployment methods.

To install SWA:

1. Download SWA artifacts from the CyberArk Marketplace under CyberArk solutions.

   Make sure you have both artifact types:

   - Container images for SWA components
   - Helm chart package for the SWA Server deployment

   If container images are provided as `.tar.gz` archives, extract and import them into a container registry that your Kubernetes cluster can reach.

   Store the Helm chart on the installation machine where you run Helm commands.

   For a Helm-based installation workflow and command examples, see [Install SWA on Kubernetes with Helm](ccl-swa-install-helm.md).
2. Install the SWA Server: Deploy the SWA Server to your Kubernetes cluster and provide the `authn_id`.

   Set `controlPlane.auth.loginURL` to the `authn_id` value from the register-server response (the chart field name is `loginURL`).

   For Kubernetes deployments, use Helm as the primary installation method for the SWA Server.

   ```
   helm install swa-server ./swa-server \
     --namespace swa-system \
     --create-namespace \
     --set controlPlane.url=https://<subdomain>.secretsmgr.cyberark.cloud \
     --set controlPlane.auth.loginURL="<authn_id captured from SWA Server creation>" \
     --set rbac.createTokenReviewRole=true \
     --set trustDomain.name=${TRUST_DOMAIN_NAME} \
     --set image.repository=<container-repository-url>/swa-server \
     --set image.tag=latest
   ```
3. Install SWA Agents: Deploy agents on nodes that run workloads.

   For Kubernetes deployments, install SWA Agents by using the SWA Agent Helm chart as a DaemonSet. For virtual machines or other machines outside the cluster, see [Install an SWA agent on a machine](ccl-swa-install-agent-machine.md).

   ```
   helm install swa-agent ./swa-agent \
     --namespace swa-system \
     --set trustDomain.name=${TRUST_DOMAIN_NAME} \
     --set server.address=swa-server.swa-system.svc.cluster.local:8443 \
     --set nodeAttestor.k8s_psat.cluster=prod-cluster \
     --set image.repository=<container-repository-url>/swa-agent \
     --set image.tag=latest \
     --set podLabels.swa_nodegroup=${NODE_GROUP_NAME}
   ```
4. Confirm installation status between the SWA Agents and the SWA Server by running this command:

   ```
   kubectl get pods -n swa-system
   ```

   This command verifies that `swa-server` and `swa-agent` started correctly. For deeper debugging, check pod logs by running:

   ```
   kubectl logs <pod-name> -n swa-system
   ```

### Step 4: Get an SVID from the agent

Workloads call the SWA Agent's Workload API through a local socket to get identities.

To generate an SVID:

1. Connect the workload to the agent Workload API socket. Depending on your installation, the socket can be at a path such as `/run/swa-agent/api.sock`, or under another directory on the node (for example when the agent exposes a socket under `/tmp/swa-agent`).

   The following example pod mounts the host directory that contains the agent socket and runs `swa-agent api fetch jwt` to retrieve a JWT SVID. Replace `<change-this-to-your-repo>` in the image value with your container registry and image reference.

   ```
   apiVersion: v1
   kind: Pod
   metadata:
     name: svid-fetcher
     namespace: default
     labels:
       app.kubernetes.io/name: svid-fetcher
   spec:
     restartPolicy: Never
     containers:
       - name: svid-fetcher
         image: <change-this-to-your-repo>/swa-agent:latest
         args:
           - api
           - fetch
           - jwt
           - --audience=conjur
           - --socketPath=/tmp/swa-agent/public/api.sock
           - --output=json
         volumeMounts:
           - name: agent-socket
             mountPath: /tmp/swa-agent
     volumes:
       - name: agent-socket
         hostPath:
           path: /tmp/swa-agent
           type: Directory
   ```
2. Save the manifest to a YAML file, apply it to your cluster, then view the pod logs after the pod completes. The log output reveals the JWT SVID token for the pod.

   ```
   kubectl apply -f svid-fetcher.yaml
   kubectl logs -n default svid-fetcher
   ```

### Step 5: Authorize workloads to pull secrets from Secrets Manager

Attested workloads appear in the Secrets Manager inventory under `data/swa/trust-domains/<trust-domain-name>/workloads/`, where `<trust-domain-name>` matches your `TRUST_DOMAIN_NAME` (for example, `prod.example` in this topic). Authorize workloads before they can access secrets.

For the complete workflow (JWT authenticator policy and variables, enablement, and secret grants), see [Integrate SWA with Secrets Manager JWT authentication](cjr-authn-jwt-swa.md).

For more information about supported signing algorithms and audience values, see [Configure JWT requirements for SWA integrations](ccl-swa-jwt.md).

## Verify success

Use these checks to confirm Secure Workload Access (SWA) installation and connectivity.

- Agent socket: Confirm the Workload API socket exists where your deployment exposes it, for example `ls -la /run/swa-agent/api.sock`, or the path under `/tmp/swa-agent` if that matches your node layout (see [Step 4: Get an SVID from the agent](#Get_SVID_agent)).
- JWT fetch test: Run `swa-agent api fetch jwt --audience conjur --output json --socketPath <path-to-socket>`, using the socket path for your environment (for example `/run/swa-agent/api.sock` or `/tmp/swa-agent/public/api.sock`). Alternatively, apply the example pod from [Step 4: Get an SVID from the agent](#Get_SVID_agent) and run `kubectl logs -n default svid-fetcher` to read the JWT SVID from the pod output.
- Server pods: `kubectl get pods --all-namespaces | grep swa-server`
- Secret retrieval: After JWT authentication and policy are configured, confirm token exchange and secret access using the checks in [Integrate SWA with Secrets Manager JWT authentication](cjr-authn-jwt-swa.md).

## Troubleshoot common issues

If workload attestation fails with kubelet TLS errors when workloads fetch JWT SVIDs, especially on self-managed Kubernetes clusters, see [Troubleshoot Secure Workload Access (SWA)](ccl-swa-troubleshooting.md).
