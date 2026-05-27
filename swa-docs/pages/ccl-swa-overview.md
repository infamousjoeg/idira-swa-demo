---
source: https://docs.cyberark.com/early-release/swa/en/content/conjurcloud/ccl-swa-overview.htm
title: Secure workload identities with SPIFFE and SWA
---

# Secure workload identities with SPIFFE and SWA

This topic describes how Secure Workload Access (SWA) uses SPIFFE (Secure Production Identity Framework for Everyone) to issue cryptographically verifiable workload identities and integrate with Secrets Manager for secrets management.

SPIFFE is an open standard for workload identity. It defines how workloads authenticate without static shared secrets.

For guidance on planning SWA node groups, SPIFFE workload templates, and registration policies, see [Design and assign SWA node groups](ccl-swa-node-groups-design.md) and [SPIFFE templates, attestors, and registration policies for SWA](ccl-swa-node-groups-templates-policies.md).

> **Note:**
>
> For more information about SPIFFE standards, see [SPIFFE Identity and Verifiable Identity Document](https://spiffe.io/docs/latest/spiffe-specs/spiffe-id/).

## How SPIFFE enables trust-based access

This section explains how SPIFFE differs from addressing secret zero at bootstrap alone, and where trust-based access applies after a workload authenticates.

Modern secrets management solutions, including Secrets Manager, already address the secret zero problem. They authenticate workloads using platform-native evidence (such as Kubernetes service account tokens or cloud provider metadata) rather than pre-shared static credentials. Eliminating secret zero in that bootstrap step is not unique to SPIFFE.

Even when initial authentication uses platform identity rather than a static bootstrap credential, many workloads still follow a conventional pattern for downstream access: they retrieve long-lived secrets (such as database passwords or API keys) and use those secrets to reach their targets. Those secrets require rotation, secure storage, and lifecycle management.

Where SPIFFE provides a clear advantage is in what happens after authentication when a workload connects to SPIFFE-compatible targets. In the conventional pattern, a workload authenticates and then retrieves a secret to access its target.

With SPIFFE, the workload receives a SPIFFE Verifiable Identity Document (SVID) and presents it directly to those targets. The target validates the identity and grants access based on trust, not based on an intermediate secret. No credential is retrieved, stored, or rotated for that trust-based connection.

This trust-based access model reduces the operational burden of credential management. It also helps reduce secret sprawl for services that implement SPIFFE identity.

## Key terms

Use these definitions to understand SPIFFE and Secure Workload Access (SWA) concepts.

| Term | Description |
| --- | --- |
| SPIFFE | An open standard for workload identity. It defines how workloads identify and authenticate without static shared secrets. |
| SPIFFE ID | A unique identifier for a workload, formatted as a URI: `spiffe://trust-domain/path`.  The trust domain identifies the issuing authority. The path identifies the workload.  Example: `spiffe://example.com/payments/api-server` (generic URI shape).  For SWA-specific path and inventory examples, see SPIFFE ID formats in SWA below. |
| SVID | A SPIFFE Verifiable Identity Document. This is a cryptographically signed credential that proves a workload's SPIFFE ID. SVIDs come in two formats: JWT-SVID and X.509-SVID. |
| JWT-SVID | An SVID in JWT format. The SWA Server signs the token by using its private key.  Relying parties verify the token against the trust domain's public JWKS endpoint. JWT-SVIDs are short-lived.  SWA issues these identities with RSA or elliptic-curve signing when you set the trust domain fields accordingly.  New trust domains default to RSA signing (`RS512` with `RSA_4096`). That default matches the Secrets Manager JWT authenticator, which accepts RSA signing only (`RS*` with `RSA_*`).  Elliptic-curve signing remains available on the trust domain for other integrations, including external platform federation.  For supported JWT signing requirements, see [Configure JWT requirements for SWA integrations](ccl-swa-jwt.md). |
| X.509-SVID | An SVID in X.509 certificate format. The SPIFFE ID is embedded in the certificate's SAN URI field. X.509-SVIDs enable mTLS connections between workloads. |
| Trust domain | A SPIFFE namespace that defines the scope of identity issuance and trust. All SPIFFE IDs within a trust domain share the same root of trust. A trust domain maps to an administrative boundary, such as a production environment or business unit. |
| Trust bundle | A set of public keys and certificates for a trust domain. Workloads use the trust bundle to verify SVIDs that are issued by that trust domain. |
| Workload API | A local API that workloads call to retrieve their SVIDs and trust bundles. The Workload API is exposed as a Unix domain socket, so workloads access it without network calls or pre-shared credentials. |
| Attestation | The process of verifying a workload's identity by examining platform-specific evidence from the runtime environment.  Attestation occurs at two levels: node attestation, which verifies the infrastructure, and workload attestation, which verifies the process. |
| Server group | A logical group of SWA Servers for a specific trust domain. It defines the allowed node types, such as AWS EC2 and Kubernetes, and the attestation method for nodes that run SWA Agents. |
| Node group | A group of SWA Agents in a server group. It sets the rules that agents use to attest nodes and workloads, and controls which workloads receive an SVID. |
| SWA Server | A component that runs in customer-managed infrastructure, connects to the control plane, serves SWA Agents, performs attestation, and issues SVIDs. |
| SWA Agent | A lightweight agent that connects to the SWA Server, exposes the Workload API, and forwards attestation data. |

## SPIFFE ID formats in SWA

SWA documentation uses SPIFFE IDs in two related ways. Use the format that matches your task.

- Secrets Manager inventory and JWT authentication: Attested workloads appear under `data/swa/trust-domains/<trust-domain-name>/workloads/` with a SPIFFE ID such as `spiffe://example-trust-domain/k8s-nodegroup/ns/my-namespace/sa/my-service-account`. Use this path for `identity-path`, policy hosts, and secret grants. See [Integrate SWA with Secrets Manager JWT authentication](cjr-authn-jwt-swa.md).
- External platform federation: External platforms that accept OIDC federation match the JWT `sub` claim to your workload SPIFFE ID. Use the SPIFFE ID your workload receives from SWA attestation (often the same k8s-nodegroup path shape as above). See [Integrate external platforms](https://docs.cyberark.com/early-release/swa/en/content/conjurcloud/ccl-cloud-platforms-lp.htm) for provider-specific procedures.

## How SPIFFE establishes workload identity

SPIFFE establishes workload identity through a two-stage chain of trust: node attestation and workload attestation.

### Node attestation

Node attestation verifies the identity of a machine, VM, or Kubernetes cluster before any workloads on that node receive SVIDs.

Node attestation evidence includes the following:

- Kubernetes: A projected service account token that the SWA Server validates against the cluster's API server.
- X.509 Proof of Possession (PoP): An existing machine certificate, signed by a trusted CA, that the node uses to prove its identity.
- Cloud provider metadata: Instance identity documents from a cloud provider.

The SWA Server evaluates the evidence against the configured attestation policies. If the evidence matches, the node joins the trust domain.

### Workload attestation

After a node is attested, individual workloads on that node request SVIDs. The SWA Agent identifies each workload by inspecting its runtime attributes.

Workload attestation attributes include the following:

- Kubernetes: Namespace, service account, pod labels, and annotations.
- Unix/Linux: User ID, group ID, executable path, and binary hash (SHA-256).

When a workload calls the Workload API, the SWA Agent collects the workload's runtime attributes and checks them against the configured policies. The agent then requests an SVID from the SWA Server, which issues the SVID for the corresponding SPIFFE ID and returns it to the agent.

### Identity flow

The following steps describe how SWA issues and renews workload identities at runtime.

1. The node starts and presents attestation evidence to the SWA Server.
2. The SWA Server validates the evidence and admits the node to the trust domain.
3. The SWA Agent on the attested node exposes the Workload API by using a Unix domain socket.
4. The workload calls the Workload API to request its identity.
5. The agent inspects the workload's runtime attributes and retrieves an SVID from the server.
6. The workload receives a short-lived SVID and the trust bundle for its trust domain.
7. SWA synchronizes the attested workload with Secrets Manager, which creates or updates the workload identity under `data/swa/trust-domains/<trust-domain-name>/workloads/` when it is new. The trust domain name separates inventories when you run multiple trust domains in one tenant. For example: `data/swa/trust-domains/example-trust-domain/workloads/spiffe://example-trust-domain/k8s-nodegroup/ns/my-namespace/sa/my-service-account`. For default secret access and grants for that identity, see What SWA manages later in this topic.
8. The workload can use the SVID for trust-based access to relying parties (for example, SPIFFE-aware services, federation and OIDC flows, or mTLS) without retrieving static secrets for those connections.
9. Optionally, the workload can authenticate to Secrets Manager (for example, by using JWT-SVID authentication) to retrieve secrets when you use that integration. This step is not required for every SWA deployment.
10. Before the SVID expires, the SWA Agent automatically renews it. No restart is required.

## How SWA implements SPIFFE

Secure Workload Access (SWA) is a SPIFFE-compliant implementation that is delivered as a feature of Secrets Manager. It adds centralized management and governance to the SPIFFE model.

### SWA architecture flow

This diagram shows how SWA authenticates components, retrieves configuration, and issues workload identities.

![Secure Workload Access architecture flow](https://docs.cyberark.com/early-release/swa/en/content/images/conjurcloud/swa-architecture.png)

This example uses AWS for illustration, but the authentication flow is platform-agnostic and supports any target resource that can validate JWT-SVIDs. You can deploy the SWA Agent and the SWA Server on virtual machines (VMs) as well as in Kubernetes.

### SWA components and roles

| SWA component | Role |
| --- | --- |
| SWA Server | Runs in your infrastructure. Performs node attestation, issues SVIDs, and manages the trust domain's signing keys. The SWA Server communicates with Secrets Manager to retrieve configuration and report workload inventory. |
| SWA Agent | Runs on each node as a DaemonSet in Kubernetes or a system service on Unix/Linux. Exposes the Workload API, performs workload attestation, and requests SVIDs from the SWA Server on behalf of workloads. |
| Secrets Manager | The centralized control plane.  Identity architects define trust domains, server groups, node groups, and attestation policies.  Secrets Manager provides workload inventory, audit logging, and public JWKS endpoints. |

## What you can do with SWA

Secure Workload Access (SWA) supports the following tasks.

- REST API and Terraform-based creation and management of Secure Workload Access (SWA) resources. To install the SWA Terraform provider, see [Install the SWA Terraform provider](ccl-swa-terraform-provider.md).
- Centralized configuration for trust domains, server groups, and node groups in Secrets Manager.
- Workload inventory in Secrets Manager with SWA identity metadata.
- Support for deploying the SWA Server on Kubernetes.
- SWA Agents that are deployed close to workloads and connected to an SWA Server.
- Support for deploying the SWA Server and SWA Agents by using Helm charts and Ansible.

> **Note:**
>
> For current regional availability and support scope, see [Secrets Manager support and scope](https://docs.cyberark.com/early-release/swa/en/content/conjurcloud/ccl-support.htm).

## What SWA manages

Secure Workload Access (SWA) manages the following tasks after you configure it.

- Centralized workload identity configuration.
- Workload inventory and identity metadata.
- Policy-driven workload attestation and identity issuance.
- Node and workload attestation and SVID issuance based on centrally managed configuration.
- OIDC endpoint management for workload identity integration.

> **Note:**
>
> After SWA attests a workload, it creates a new workload identity under `data/swa/trust-domains/<trust-domain-name>/workloads/` (for example, `data/swa/trust-domains/example-trust-domain/workloads/`). The new identity has no secret access by default. Grant permissions to the new identity before the workload can retrieve secrets.
>
> When you migrate from a non-SWA authenticator to SPIFFE-based authentication, SWA does not use the existing workload identity. Delete the old identity, and then grant permissions to the new SPIFFE-based identity. Plan for a short service interruption during the change.

## Common use cases

Secure Workload Access (SWA) and SPIFFE address common workload identity challenges across hybrid and multi-cloud environments.

- Cross-environment authentication: Workloads on on-premises Kubernetes clusters authenticate to cloud services, such as AWS S3 or Azure Blob Storage, by using JWT-SVIDs instead of long-lived access keys.
- Secret zero removal: On-premises VMs obtain SPIFFE identities through X.509 PoP attestation. They can use those identities without static bootstrap credentials, for example, to retrieve secrets from Secrets Manager or to access other SPIFFE-compatible services.
- Unified identity across platforms: Kubernetes workloads and Unix processes in the same trust domain share a common identity framework, which enables consistent authentication and authorization policies.
- Service-to-service authentication: Workloads authenticate directly to each other by using SVIDs, which removes the need for shared API keys or manually distributed certificates.

## Next steps

For the primary SWA setup workflow on Kubernetes, see [Secure workloads with SWA](ccl-getstarted-swa-lp.md).
