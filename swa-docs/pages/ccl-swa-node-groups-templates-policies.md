---
source: https://docs.cyberark.com/early-release/swa/en/content/conjurcloud/ccl-swa-node-groups-templates-policies.htm
title: SPIFFE templates, attestors, and registration policies for SWA
---

# SPIFFE templates, attestors, and registration policies for SWA

Use this reference when you configure workload SPIFFE ID templates, the SWA Agent attestors, and registration policies. Workloads use the SVIDs that SWA issues to authenticate to Secrets Manager and to access secrets.

This topic is the companion to [Design and assign SWA node groups](ccl-swa-node-groups-design.md). You store node group template and policy settings in Secrets Manager - SaaS when you create or update node groups using the SWA REST API or Terraform. For declarative management with Terraform, see [Install the SWA Terraform provider](ccl-swa-terraform-provider.md).

For REST API field definitions when you create or update node groups, see [Create node group](https://docs.cyberark.com/early-release/swa/en/content/conjurcloud/apis/ccl-api-swa-create-node-group.htm) and [Update node group](https://docs.cyberark.com/early-release/swa/en/content/conjurcloud/apis/ccl-api-swa-update-node-group.htm).

## SPIFFE ID workload templates

Each node group defines a SPIFFE ID template that controls how workload identities are structured. The template uses Go template syntax and must begin with `spiffe://{{ .trustdomain }}/{{ .nodegroup }}/`.

The SPIFFE ID template is optional when creating a node group. If you omit it, SWA applies a built-in default template based on the node group's workload type.

### Default templates

| Workload Type | Default Template |
| --- | --- |
| Kubernetes | `spiffe://{{ .trustdomain }}/{{ .nodegroup }}/ns/{{ .k8s.ns }}/sa/{{ .k8s.sa }}` |
| Unix | `spiffe://{{ .trustdomain }}/{{ .nodegroup }}/workload/{{ .unix.user }}` |

### Template variables

The following tables list the Go template fields you can use in a node group SPIFFE ID template. Values come from workload attestation. Selectors from a workload attestor are populated only when that attestor is enabled on the SWA Agent; if it is disabled, those selectors resolve empty.

Common variables (all workload types):

| Variable | Description |
| --- | --- |
| `{{ .trustdomain }}` | Trust domain name |
| `{{ .nodegroup }}` | Node group name |

Kubernetes template variables map to pod and container metadata that the Kubernetes workload attestor collects.

Kubernetes workload variables:

| Variable | Description |
| --- | --- |
| `{{ .k8s.ns }}` | Pod namespace |
| `{{ .k8s.sa }}` | Service account name |
| `{{ .k8s.pod_name }}` | Pod name |
| `{{ .k8s.pod_uid }}` | Pod UID |
| `{{ .k8s.pod_label.<key> }}` | Value of a specific pod label |
| `{{ .k8s.pod_owner }}` | Name of the pod's owner resource (for example, Deployment name) |
| `{{ .k8s.pod_owner_uid }}` | UID of the pod's owner resource |
| `{{ .k8s.container_name }}` | Container name within the pod |
| `{{ .k8s.container_image }}` | Container image reference |
| `{{ .k8s.node_name }}` | Name of the node running the pod |
| `{{ .k8s.pod_image }}` | Pod-level image reference |
| `{{ .k8s.pod_image_count }}` | Number of images in the pod |
| `{{ .k8s.pod_init_image }}` | Init container image reference |
| `{{ .k8s.pod_init_image_count }}` | Number of init container images |

When image signature verification is enabled for the Kubernetes workload attestor, you can reference signing and attestation metadata in templates.

Image signature selectors (Kubernetes):

| Variable | Description |
| --- | --- |
| `{{ .k8s.image_signature.verified }}` | Whether the image signature is verified |
| `{{ .k8s.image_attestations.verified }}` | Whether image attestations are verified |
| `{{ .k8s.image_signature.value }}` | Signature value |
| `{{ .k8s.image_signature.subject }}` | Signing certificate subject |
| `{{ .k8s.image_signature.issuer }}` | Signing certificate issuer |
| `{{ .k8s.image_signature.log_id }}` | Transparency log ID |
| `{{ .k8s.image_signature.log_index }}` | Transparency log index |
| `{{ .k8s.image_signature.integrated_time }}` | Time integrated into transparency log |
| `{{ .k8s.image_signature.signed_entry_timestamp }}` | Signed entry timestamp |

Unix templates apply to process-based workloads that the Unix workload attestor observes.

Unix workload variables:

| Variable | Description |
| --- | --- |
| `{{ .unix.uid }}` | User ID |
| `{{ .unix.user }}` | User name running the process |
| `{{ .unix.gid }}` | Group ID |
| `{{ .unix.group }}` | Group name |
| `{{ .unix.supplementary_gid }}` | Supplementary group ID |
| `{{ .unix.supplementary_group }}` | Supplementary group name |
| `{{ .unix.path }}` | Executable path |
| `{{ .unix.sha256 }}` | SHA-256 hash of the binary |

Docker templates apply when the Docker workload attestor is enabled and the workload runs in a container the attestor can inspect.

Docker variables:

| Variable | Description |
| --- | --- |
| `{{ .docker.label.<key> }}` | Value of a container label |
| `{{ .docker.env.<key> }}` | Value of a container environment variable |
| `{{ .docker.image_id }}` | Container image ID |
| `{{ .docker.image_config_digest }}` | Image configuration digest |
| `{{ .docker.image_signature.verified }}` | Whether the image signature is verified |
| `{{ .docker.image_attestations.verified }}` | Whether image attestations are verified |
| `{{ .docker.image_signature.value }}` | Signature value |
| `{{ .docker.image_signature.subject }}` | Signing certificate subject |
| `{{ .docker.image_signature.issuer }}` | Signing certificate issuer |
| `{{ .docker.image_signature.log_id }}` | Transparency log ID |
| `{{ .docker.image_signature.log_index }}` | Transparency log index |
| `{{ .docker.image_signature.integrated_time }}` | Time integrated into transparency log |
| `{{ .docker.image_signature.signed_entry_timestamp }}` | Signed entry timestamp |

Docker and image signature selectors support container image verification use cases, where identity should be tied to a specific verified and signed image rather than runtime metadata alone.

### Template validation rules

SWA validates templates when you create or update a node group. Templates that violate the SPIFFE specification are rejected immediately. Key rules:

- The template must begin with `spiffe://{{ .trustdomain }}/{{ .nodegroup }}/`, matching the required prefix described earlier in this topic.
- Path segments must not be empty (no double slashes `//`)
- All template variables must resolve to non-empty values

> **Note:**
>
> Variables that produce path-like values (such as `{{ .unix.path }}`, which resolves to `/usr/bin/nginx`) create additional path segments. Use these variables as the final segment or encode them to avoid producing empty segments that violate the SPIFFE ID specification.

### Template examples

Kubernetes: identity by namespace and service account (default)

```
spiffe://{{ .trustdomain }}/{{ .nodegroup }}/ns/{{ .k8s.ns }}/sa/{{ .k8s.sa }}
```

Result: `spiffe://example.org/k8s-production/ns/payments/sa/processor`

Kubernetes: identity including a team label

```
spiffe://{{ .trustdomain }}/{{ .nodegroup }}/team/{{ .k8s.pod_label.team }}/ns/{{ .k8s.ns }}/sa/{{ .k8s.sa }}
```

Result: `spiffe://example.org/k8s-production/team/platform/ns/payments/sa/processor`

Unix: identity by user name

```
spiffe://{{ .trustdomain }}/{{ .nodegroup }}/user/{{ .unix.user }}
```

Result: `spiffe://example.org/web-frontend/user/www-data`

Unix: identity by user and binary hash (high-security)

```
spiffe://{{ .trustdomain }}/{{ .nodegroup }}/user/{{ .unix.user }}/sha256/{{ .unix.sha256 }}
```

Result: `spiffe://example.org/api-backend/user/appuser/sha256/a1b2c3d4...`

> **Note:**
>
> Choose template variables that produce stable identities. Avoid using `{{ .k8s.pod_name }}` unless you intentionally want per-pod identity, because pod names change on every restart.

## Identity granularity and security boundaries

This section explains how SPIFFE path composition affects identity separation, shows collision examples and template specificity, and describes how SPIFFE ID templates work together with workload registration policies.

### How identity collisions occur

If two workloads resolve to the same SPIFFE ID, they share the same identity. This means they can access the same resources and impersonate each other from the perspective of any relying party.

For example, a template using only namespace:

```
spiffe://{{ .trustdomain }}/{{ .nodegroup }}/ns/{{ .k8s.ns }}
```

This gives every workload in the `payments` namespace the same SPIFFE ID: `spiffe://example.org/k8s-production/ns/payments`. Any workload in that namespace can then access resources that trust this identity, regardless of its actual function.

### Choose selectors that match your security posture

| Template Specificity | Example | Identity Granularity |
| --- | --- | --- |
| Namespace only | `/ns/{{ .k8s.ns }}` | All workloads in namespace share one identity |
| Namespace + service account | `/ns/{{ .k8s.ns }}/sa/{{ .k8s.sa }}` | Each service account has a distinct identity |
| Namespace + SA + label | `/ns/{{ .k8s.ns }}/sa/{{ .k8s.sa }}/ver/{{ .k8s.pod_label.version }}` | Each version of each service account has a distinct identity |

For most deployments, namespace plus service account (the default Kubernetes template) provides sufficient separation. Use more specific selectors when workloads within the same service account need distinct identities.

### Combine templates with policies

Templates control identity structure. Policies control who receives an identity at all. Use both together:

- Templates determine the granularity of identities (how specific each SPIFFE ID is).
- Policies restrict which workloads are eligible for any identity (which workloads get SVIDs).

The next section is Workload attestor configuration, which controls which selectors are available in templates and policies. The Workload registration policies section later in this topic documents Common Expression Language (CEL) syntax and examples for restricting which workloads receive SVIDs.

## Workload attestor configuration

The selectors available for templates and policies depend on which workload attestors are enabled in the SWA Agent configuration.

| Attestor | Selectors Provided | Default Deployment |
| --- | --- | --- |
| `k8s` | `k8s.*` selectors | Enabled by default in the Helm chart |
| `unix` | `unix.*` selectors | Enabled by default in the Ansible role |
| `docker` | `docker.*` selectors | Must be explicitly enabled |

The SWA Agent Helm chart enables the Kubernetes attestor by default. To enable additional attestors (such as Docker for container image verification), configure them in the Helm values file. The SWA Agent Ansible role enables the Unix attestor by default. You add any additional attestors through the role variables. To install agents on machines with Ansible, see [Install an SWA agent on a machine](ccl-swa-install-agent-machine.md).

SWA inherits attestor configuration from the SPIRE workload attestor plugins.

### Kubernetes attestor settings

Use these fields under the Kubernetes workload attestor `config` object when you tune kubelet access and optional image signature verification.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `node_name_env` | string | `MY_NODE_NAME` | Environment variable containing the node name |
| `node_name` | string |  | Direct node name (overrides `node_name_env`) |
| `skip_kubelet_verification` | boolean | `false` | Skip TLS verification for kubelet connection |
| `kubelet_ca_path` | string | `/run/secrets/kubernetes.io/serviceaccount/ca.crt` | CA certificate path for kubelet verification |
| `kubelet_secure_port` | integer | `10250` | Kubelet HTTPS port |
| `kubelet_read_only_port` | integer |  | Insecure kubelet port (mutually exclusive with `kubelet_secure_port`) |
| `token_path` | string | `/run/secrets/kubernetes.io/serviceaccount/token` | Bearer token path for kubelet authentication |
| `certificate_path` | string |  | Client certificate path for X.509 authentication |
| `private_key_path` | string |  | Client private key path for X.509 authentication |
| `use_anonymous_authentication` | boolean | `false` | Use anonymous authentication for kubelet |
| `disable_container_selectors` | boolean | `false` | Disable container selectors when container is not yet ready |
| `sigstore` | object |  | Enables container image signature verification |

### Unix attestor settings

These fields belong under the Unix workload attestor `config` object when you enable path discovery or cap how much of each binary is hashed.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `discover_workload_path` | boolean | `false` | Discover the workload binary path for `path` and `sha256` selectors |
| `workload_size_limit` | integer | `0` | Maximum binary size (bytes) for SHA-256 calculation. Zero means no limit. Negative disables hashing. |

### Docker attestor settings

These fields belong under the Docker workload attestor `config` object, including how the agent reaches the container runtime and optional image signature verification.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `docker_socket_path` | string | `unix:///var/run/docker.sock` | Docker daemon socket path |
| `podman_socket_path` | string | `unix:///run/podman/podman.sock` | Rootful Podman socket path |
| `podman_socket_path_template` | string | `unix:///run/user/%d/podman/podman.sock` | Rootless Podman socket path (`%d` is replaced with UID) |
| `docker_version` | string |  | Docker API version |
| `container_id_cgroup_matchers` | list |  | Patterns to discover container IDs from cgroup entries |
| `sigstore` | object |  | Enables container image signature verification |

Example: the SWA Agent configuration with Kubernetes, Unix, and Docker workload attestors enabled (adjust keys, sockets, and cluster names for your environment; omit or replace optional blocks per your chart version).

```
trustDomain:
  name: example.com
servers:
  - addr: swa-server.swa-system.svc.cluster.local:8443
agent:
  socketPath: /tmp/swa-agent/public/api.sock
  nodeAttestor:
    type: k8s_psat
    config:
      cluster: prod-cluster
      token_path: /var/run/secrets/swa/serviceaccount/token
workload:
  attestors:
    - type: k8s
      config:
        node_name_env: MY_NODE_NAME
        skip_kubelet_verification: false
    - type: unix
      config:
        discover_workload_path: true
        workload_size_limit: 10485760
    - type: docker
      config:
        docker_socket_path: "unix:///var/run/docker.sock"
telemetry:
  logging:
    level: info
```

> **Note:**
>
> You can use only selectors from workload attestors you enabled in templates and CEL policies.
>
> If you reference a selector from a disabled attestor, the variable resolves to empty and the workload might not receive the expected SPIFFE ID.

## Workload registration policies

A workload registration policy defines which workloads within a node group are allowed to receive SVIDs. Policies use [CEL (Common Expression Language)](https://cel.dev/) expressions evaluated against workload attestation selectors.

### How policies work

- Each node group can have zero or more CEL expressions in its `workload_registration_policies` array.
- At least one expression must evaluate to `true` for SWA to issue an SVID (OR semantics).
- If no policies are defined, all workloads attested on nodes in the group receive SVIDs.
- SWA parses CEL expressions at save time. Syntax errors (missing operators, unbalanced parentheses) are rejected immediately with a descriptive error message.
- However, variable names are not checked against the available selectors at save time. A policy referencing a non-existent variable (for example, `k8s.nonexistent == 'value'`) is accepted but will not match any workload at evaluation time. Test policies against actual workloads to verify correct behavior.

### Available CEL variables

The following tables list CEL variable names for workload registration policies. They align with the attestation selectors used in SPIFFE ID templates; selectors from enabled workload attestors populate, and selectors from disabled attestors resolve empty.

Kubernetes workload selectors:

| Variable | Type | Description |
| --- | --- | --- |
| `k8s.ns` | string | Pod namespace |
| `k8s.sa` | string | Service account name |
| `k8s.pod_name` | string | Pod name |
| `k8s.pod_uid` | string | Pod UID |
| `k8s.pod_label.<key>` | string | Value of a pod label |
| `k8s.pod_owner` | string | Name of the pod's owner resource |
| `k8s.pod_owner_uid` | string | UID of the pod's owner resource |
| `k8s.container_name` | string | Container name |
| `k8s.container_image` | string | Container image reference |
| `k8s.node_name` | string | Node name |
| `k8s.pod_image` | string | Pod-level image reference |
| `k8s.pod_image_count` | string | Number of images in the pod |
| `k8s.pod_init_image` | string | Init container image reference |
| `k8s.pod_init_image_count` | string | Number of init container images |
| `k8s.image_signature.verified` | string | Whether image signature is verified |
| `k8s.image_attestations.verified` | string | Whether image attestations are verified |
| `k8s.image_signature.subject` | string | Signing certificate subject |
| `k8s.image_signature.issuer` | string | Signing certificate issuer |

Unix workload selectors:

| Variable | Type | Description |
| --- | --- | --- |
| `unix.uid` | integer | User ID |
| `unix.user` | string | User name |
| `unix.gid` | integer | Group ID |
| `unix.group` | string | Group name |
| `unix.supplementary_gid` | integer | Supplementary group ID |
| `unix.supplementary_group` | string | Supplementary group name |
| `unix.path` | string | Executable path |
| `unix.sha256` | string | SHA-256 hash of the binary |

Docker selectors (available for both workload types):

| Variable | Type | Description |
| --- | --- | --- |
| `docker.label.<key>` | string | Container label value |
| `docker.env.<key>` | string | Container environment variable value |
| `docker.image_id` | string | Container image ID |
| `docker.image_config_digest` | string | Image configuration digest |
| `docker.image_signature.verified` | string | Whether image signature is verified |
| `docker.image_attestations.verified` | string | Whether image attestations are verified |
| `docker.image_signature.subject` | string | Signing certificate subject |
| `docker.image_signature.issuer` | string | Signing certificate issuer |

### Policy examples

Allow only workloads in the `payments` namespace:

```
k8s.ns == 'payments'
```

Exclude system namespaces:

```
k8s.ns not in ['kube-system', 'kube-public', 'kube-node-lease']
```

Restrict to a specific service account:

```
k8s.ns == 'payments' && k8s.sa == 'payment-processor'
```

Allow only workloads with a specific label:

```
k8s.pod_label.identity_enabled == 'true'
```

Unix: allow only non-root processes:

```
unix.uid > 1000
```

Unix: restrict to a specific binary:

```
unix.path == '/usr/local/bin/myapp'
```

Unix: restrict to a group:

```
unix.group == 'appservers'
```

Combining multiple policies (OR semantics): When you add multiple policies to a node group, a workload must match at least one:

```
{
  "workload_registration_policies": [
    "k8s.ns == 'payments'",
    "k8s.ns == 'orders' && k8s.sa == 'order-service'"
  ]
}
```

This enables all workloads in the `payments` namespace, plus the `order-service` service account in the `orders` namespace.

> **Note:**
>
> An empty `workload_registration_policies` array means all workloads on attested nodes receive their own unique SPIFFE identity based on the node group's template. This is a valid configuration when every workload on a node should have an identity. Add policies when you need to restrict which workloads are eligible for SVID issuance.

## Next steps

- [Design and assign SWA node groups](ccl-swa-node-groups-design.md)
- [Get started with SWA on Kubernetes](ccl-swa-getstarted-k8.md)
- [Install SWA on Kubernetes with Helm](ccl-swa-install-helm.md)
- [Integrate SWA with Secrets Manager JWT authentication](cjr-authn-jwt-swa.md)
