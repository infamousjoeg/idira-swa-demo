---
source: https://docs.cyberark.com/early-release/swa/en/content/conjurcloud/ccl-swa-troubleshooting.htm
title: Troubleshoot Secure Workload Access (SWA)
---

# Troubleshoot Secure Workload Access (SWA)

This topic describes how to resolve common problems you might see when you run Secure Workload Access (SWA) on Kubernetes, including workload attestation and SVID retrieval errors for administrators and platform engineers.

For more information about Helm chart parameters and install commands, see [Install SWA on Kubernetes with Helm](ccl-swa-install-helm.md).

If `terraform init` does not load the Secure Workload Access (SWA) provider, see [Install the SWA Terraform provider](ccl-swa-terraform-provider.md).

For SWA deployment entry points, see [Secure workloads with SWA](ccl-getstarted-swa-lp.md). For external platform federation and related integration topics, see [Integrate external platforms](https://docs.cyberark.com/early-release/swa/en/content/conjurcloud/ccl-cloud-platforms-lp.htm).

## Kubelet TLS verification errors on Kubernetes

Use this section when the SWA Agent uses the `k8s` workload attestor and workloads return TLS or certificate errors that reference the kubelet API.

On the SWA Agent, the Kubernetes workload attestor queries the local kubelet API (`https://127.0.0.1:10250/pods`) to verify workload identity. This connection requires TLS. If the SWA Agent does not trust the CA that signed the kubelet certificate, workload attestation fails.

### Symptoms

When workloads try to retrieve SVIDs, they fail with an error similar to the following:

```
spiffe.workloadapi.errors.FetchJwtSvidError: Error fetching JWT SVID:
  Could not process response from the Workload API: failed to attest workload:
  workload attestator "k8s" failed: rpc error: code = Internal desc = unable to
  perform request: Get "https://127.0.0.1:10250/pods": x509: certificate signed
  by unknown authority (StatusCode.INTERNAL)
```

### Cause

On managed Kubernetes services (EKS, GKE, AKS), kubelet certificates are typically signed by a publicly trusted or platform-managed CA. The SWA Agent usually trusts these certificates without extra configuration.

If you still see `x509: certificate signed by unknown authority` for the kubelet endpoint on a managed cluster, configure `kubeletCAPath` to the CA bundle that signs the kubelet serving certificate, or follow the host mount pattern in Custom kubelet CA (rare).

On self-managed clusters (kubeadm, Rancher, bare-metal), kubelet certificates are signed by the cluster's own CA (typically `/etc/kubernetes/pki/ca.crt`). The SWA Agent does not trust this CA by default.

### Solution: configure kubeletCAPath

Set `kubeletCAPath` in the workload attestor configuration to point to the CA bundle that signed the kubelet certificate.

We recommend this configuration instead of skipping kubelet verification.

On most kubeadm clusters, the cluster CA also signs the kubelet certificate. The SWA Agent Helm chart already mounts the cluster CA through the `kubelet-token` projected volume at `/var/run/secrets/kubernetes.io/serviceaccount/ca.crt`. You do not need extra volumes for that case.

Keep other workload attestors (such as `unix`) in the same list when they are enabled. The following example shows only the `k8s` block that must include kubelet trust settings:

```
workloadAttestors:
  - type: k8s
    config:
      skipKubeletVerification: false
      kubeletCAPath: /var/run/secrets/kubernetes.io/serviceaccount/ca.crt
      nodeNameEnv: MY_NODE_NAME
```

### Custom kubelet CA (rare)

If the kubelet CA differs from the cluster CA, mount the host CA into the agent pod by using `extraVolumes` and `extraVolumeMounts`:

```
workloadAttestors:
  - type: k8s
    config:
      skipKubeletVerification: false
      kubeletCAPath: /etc/swa/kubelet-ca/ca.crt
      nodeNameEnv: MY_NODE_NAME

extraVolumes:
  - name: kubelet-ca
    hostPath:
      path: /etc/kubernetes/pki
      type: Directory

extraVolumeMounts:
  - name: kubelet-ca
    mountPath: /etc/swa/kubelet-ca
    readOnly: true
```

This example mounts the host `/etc/kubernetes/pki` directory (where kubeadm stores its CA) into the agent pod.

Set `kubeletCAPath` to the PEM file for the CA that signs the kubelet serving certificate. Paths and file names differ by distribution.

### Workaround: skip kubelet verification

For test environments where distributing the kubelet CA is not practical, you can disable TLS verification for the kubelet connection:

```
workloadAttestors:
  - type: k8s
    config:
      skipKubeletVerification: true
      nodeNameEnv: MY_NODE_NAME
```

> **Note:**
>
> Caution: Skipping kubelet verification means the SWA Agent cannot confirm it is communicating with the real kubelet. Use this setting only in non-production environments.
