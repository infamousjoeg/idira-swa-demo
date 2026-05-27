---
source: https://docs.cyberark.com/early-release/swa/en/content/conjurcloud/ccl-swa-node-groups-design.htm
title: Design and assign SWA node groups
---

# Design and assign SWA node groups

This topic helps you plan Secure Workload Access (SWA) node groups so workloads receive consistent SPIFFE identities, templates, and policy boundaries. When you design SWA for Kubernetes or Unix-style VMs, read this topic before you follow setup procedures. You learn why node groups exist, how the SWA Agent identity differs from workload identity, how node attestation works, and how nodes join a group.

You create trust domains, server groups, and node groups in Secrets Manager - SaaS, for example, by using the SWA REST API or Terraform. For installation and API walkthroughs, see [Get started with SWA on Kubernetes](ccl-swa-getstarted-k8.md), [Install SWA on Kubernetes with Helm](ccl-swa-install-helm.md), and [Secure Workload Access APIs](https://docs.cyberark.com/early-release/swa/en/content/conjurcloud/apis/ccl-api-swa-lp.htm). For declarative management with Terraform, see [Install the SWA Terraform provider](ccl-swa-terraform-provider.md).

For SPIFFE ID templates, workload attestors, and registration policies, see [SPIFFE templates, attestors, and registration policies for SWA](ccl-swa-node-groups-templates-policies.md).

A node group is a logical grouping of nodes within a server group. It controls which workloads receive SPIFFE identities, how those identities are structured, and what policies govern SVID issuance.

A server group is the parent container for node groups within a trust domain. It defines the node attestation method (Kubernetes or X.509 proof-of-possession) and holds the configuration that the SWA Server uses to verify connecting agents. All node groups within a server group share the same attestation method.

## Why node groups exist

SWA issues SPIFFE identities to workloads. To do this, SWA must know which workloads run on which nodes, and how to differentiate them. The challenge varies by platform.

### Kubernetes: namespace and service account provide uniqueness

In Kubernetes, workloads are already uniquely identifiable by namespace and service account. A single node group can represent an entire cluster because Kubernetes metadata provides the differentiation SWA needs to assign distinct SPIFFE IDs.

For example, two workloads in the same cluster can receive different identities without any additional grouping:

```
spiffe://example.org/k8s-production/ns/payments/sa/processor
spiffe://example.org/k8s-production/ns/frontend/sa/web
```

A typical pattern is one node group per Kubernetes cluster.

### Unix: workloads need explicit grouping

On Unix/Linux VMs, the same workload binary (for example, a web server) can run on many different machines with identical process attributes. A web server running as `www-data` on one VM is indistinguishable from the same web server running as `www-data` on another VM based on process selectors alone.

Node groups solve this by letting you group VMs that share a common purpose. You map each group to an infrastructure-level construct, such as an AWS Auto Scaling group (ASG) or a set of VMs behind a specific load balancer.

| Node Group | Mapped Infrastructure | Purpose |
| --- | --- | --- |
| `web-frontend` | Auto Scaling group for frontend VMs | Public-facing web servers |
| `api-backend` | Auto Scaling group for API VMs | Internal API services |
| `batch-workers` | Auto Scaling group for batch VMs | Background job processors |

This gives each tier its own SPIFFE ID namespace, even though all tiers run the same web server binary.

## SWA Agent identity and workload identity

SWA uses two distinct layers of identity. Understanding this distinction is essential for configuring node groups correctly.

SWA Agent identity is the SPIFFE ID assigned to the SWA Agent itself during node attestation. The system constructs this identity from a fixed, system-managed template that is not user-configurable. The node group name is embedded as a path segment in the SWA Agent's SPIFFE ID, and the SWA Server extracts it to determine which node group the agent belongs to.

For example, a Kubernetes SWA Agent's identity follows this pattern:

```
spiffe://<trustdomain>/agent/<nodegroup>/cluster/<cluster>/ns/<agent-ns>/sa/<agent-sa>/pod/<pod-name>
```

Workload identity is the SPIFFE ID assigned to application workloads that request SVIDs through the SWA Agent. This is the template you configure on the node group. When an application calls the Workload API, the SWA Agent inspects the workload's attributes (namespace, service account, UID, and similar) and constructs the SPIFFE ID using your template.

| Aspect | SWA Agent Identity | Workload Identity |
| --- | --- | --- |
| Assigned to | SWA Agent | Application workloads |
| Template | System-managed (not configurable) | User-configured on the node group |
| Determined during | Node attestation | Workload attestation |
| Contains node group | Yes (as a path segment) | Yes (as `{{ .nodegroup }}` prefix) |
| Purpose | Identifies the SWA Agent to the SWA Server | Identifies the workload to external systems |

## Node attestation: how SWA trusts a node

Before a node can join a node group, SWA must verify its identity. This process is called node attestation. The SWA Agent on the node presents platform-specific evidence to the SWA Server, which validates it against the server group's attestation configuration.

Node attestation configuration lives on the server group, not on individual node groups. All node groups within a server group share the same attestation method.

### Kubernetes projected service account token (k8s\_psat)

The SWA Agent runs as a pod (deployed via DaemonSet) and uses a Kubernetes projected service account token for attestation.

How it works:

1. Kubernetes mounts a projected service account token into the SWA Agent pod with the configured audience.
2. During attestation, the SWA Agent presents this token to the SWA Server.
3. The SWA Server validates the token against the Kubernetes API server using the configured cluster connection details.
4. On successful validation, the SWA Server constructs the agent's SPIFFE ID and extracts the node group name from the `swa_nodegroup` pod label.

Server group configuration:

```
node_attestation:
  k8s_psat:
    clusters:
      "production-cluster":
        service_account_allow_list:
          - "swa-system:swa-agent"
        audience:
          - "swa-server"
        allowed_pod_label_keys:
          - "swa_nodegroup"
        allowed_node_label_keys:
          - "topology.kubernetes.io/zone"
```

| Field | Description |
| --- | --- |
| `clusters` | Map of operator-chosen cluster identifiers to Kubernetes PSAT settings for that cluster |
| `service_account_allow_list` | Allowed `namespace:serviceaccount` combinations for the SWA Agent |
| `audience` | Expected audience in the projected service account token |
| `allowed_pod_label_keys` | Pod label keys that the SWA Server reads during attestation |
| `allowed_node_label_keys` | Node label keys that the SWA Server reads during attestation |

> **Note:**
>
> Important: The keys in the `clusters` map are operator-chosen identifiers, not Kubernetes cluster names. Each key must match the value the SWA Agent sets in `nodeAttestor.config.cluster`. If the two values do not match, attestation fails. Each `clusters` entry also includes server-side connection settings (for example `kube_config_file`) keyed by the same identifier; those settings are separate from the identifier string. The identifier does not need to match the cluster name in your kubeconfig, GKE/EKS/AKS console, or Kubernetes API. Choose any string that uniquely identifies the cluster within the server group, then configure both sides to use it.

The following snippets show the matching values on both sides. The cluster identifier `production-cluster` is the same string in each file.

Server group configuration:

```
node_attestation:
  k8s_psat:
    clusters:
      "production-cluster":          # operator-chosen identifier
        service_account_allow_list:
          - "swa-system:swa-agent"
        audience:
          - "swa-server"
```

Agent configuration:

```
agent:
  nodeAttestor:
    type: k8s_psat
    config:
      cluster: production-cluster    # must match the server-side key
      token_path: /var/run/secrets/swa/serviceaccount/token
```

When you deploy the SWA Agent with Helm, set the same identifier with `nodeAttestor.k8s_psat.cluster`. Examples in other topics may use different identifiers (for example `prod-cluster`); only the server group key and the agent or Helm value in your deployment must match. For chart values, see [Install SWA on Kubernetes with Helm](ccl-swa-install-helm.md).

> **Note:**
>
> The `swa_nodegroup` label must be listed in `allowed_pod_label_keys`. This is a hard requirement for node group assignment. The SWA control plane automatically injects this entry when configuring k8s\_psat attestation, even when you do not define it.

### X.509 proof-of-possession (x509pop)

The node has an existing X.509 certificate signed by a trusted certificate authority.

How it works:

1. The SWA Agent presents its machine certificate to the SWA Server during attestation.
2. The SWA Server validates the certificate chain against the CA bundle configured on the server group.
3. On successful validation, the SWA Server constructs the agent's SPIFFE ID and extracts the node group name from the certificate Subject Common Name (CN).

Server group configuration:

```
node_attestation:
  x509pop:
    ca_certificates: |
      -----BEGIN CERTIFICATE-----
      <PEM-encoded CA certificate>
      -----END CERTIFICATE-----
```

The `ca_certificates` field accepts one or more PEM-encoded CA certificates. The SWA Server trusts any node certificate signed by these CAs.

> **Note:**
>
> Control who can issue certificates from the trusted CA. Any certificate signed by the configured CA can attest as a node. Use a dedicated intermediate CA for SWA node certificates rather than your organization's root CA.

To install SWA Agents on machines with `x509pop` attestation, see [Install an SWA agent on a machine](ccl-swa-install-agent-machine.md).

## How nodes join a specific node group

Node group assignment uses a convention-over-configuration approach. The node group name is extracted from the agent's SPIFFE ID, which the system constructs during node attestation. The source of the node group name depends on the attestation method.

### Node group name constraints

The node group name must match the value of the `swa_nodegroup` pod label on the SWA Agent (Kubernetes) or the Subject CN in the node's X.509 certificate (X.509 proof-of-possession) exactly. The same string is used in SPIFFE ID paths, so choose names that stay valid in every context.

For the validation rules that apply to the `name` field when you create a node group through the API (length, allowed characters, case sensitivity), see [Create node group](https://docs.cyberark.com/early-release/swa/en/content/conjurcloud/apis/ccl-api-swa-create-node-group.htm).

### Kubernetes: pod label on the SWA Agent

For Kubernetes attestation, the SWA Agent pod must carry a label named `swa_nodegroup`. The label's value determines which node group the node joins.

Example DaemonSet configuration:

```
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: swa-agent
  namespace: swa-system
spec:
  selector:
    matchLabels:
      app: swa-agent
  template:
    metadata:
      labels:
        app: swa-agent
        swa_nodegroup: "k8s-production"
    spec:
      serviceAccountName: swa-agent
      containers:
        - name: swa-agent
          image: <container-repository-url>/swa-agent:latest
```

In this example, nodes running this DaemonSet join the node group named `k8s-production`. To assign different nodes to different node groups within the same cluster, deploy separate DaemonSet configurations with different `swa_nodegroup` label values and use node selectors or affinities to target specific nodes.

### Unix: Common Name in the X.509 node certificate

For X.509 PoP attestation, the Subject Common Name (CN) in the node's certificate determines the node group. The CN must match the node group name exactly.

Example: To assign a VM to the node group `web-frontend`, issue a certificate with:

```
Subject: CN=web-frontend
```

All VMs presenting certificates with `CN=web-frontend` join the same node group. This maps naturally to infrastructure automation. For example, when provisioning an Auto Scaling group, configure the launch template to request a certificate with a CN matching the intended node group name.

| Infrastructure | Certificate CN | Node Group |
| --- | --- | --- |
| AWS Auto Scaling group "frontend" | `web-frontend` | `web-frontend` |
| AWS Auto Scaling group "api" | `api-backend` | `api-backend` |
| Ansible host group "workers" | `batch-workers` | `batch-workers` |

> **Note:**
>
> SWA cannot prevent a certificate from being copied to another machine. If the same certificate is used on multiple VMs, all those VMs join the same node group. This is by design: nodes within a node group are considered equivalent.

## Identity separation and shared responsibility

SWA gives you tools to control identity issuance, but maintaining strong identity separation is your organization's responsibility. The selectors you use in SPIFFE ID templates and workload registration policies define your security boundaries.

If two workloads resolve to the same SPIFFE ID, relying parties treat them as one identity, which implies shared access and mutual impersonation risk.

For more information about selector granularity, collision examples, template specificity guidance, and combining templates with workload registration policies, see [SPIFFE templates, attestors, and registration policies for SWA](ccl-swa-node-groups-templates-policies.md). For security-focused detail, see [Identity granularity and security boundaries](ccl-swa-node-groups-templates-policies.md#Identity_granularity_and_security_boundaries) in that topic.

## Next steps

- [SPIFFE templates, attestors, and registration policies for SWA](ccl-swa-node-groups-templates-policies.md)
- [Get started with SWA on Kubernetes](ccl-swa-getstarted-k8.md)
- [Install SWA on Kubernetes with Helm](ccl-swa-install-helm.md)
- [Integrate SWA with Secrets Manager JWT authentication](cjr-authn-jwt-swa.md)
