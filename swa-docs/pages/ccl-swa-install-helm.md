---
source: https://docs.cyberark.com/early-release/swa/en/content/conjurcloud/ccl-swa-install-helm.htm
title: Install SWA on Kubernetes with Helm
---

# Install SWA on Kubernetes with Helm

This topic describes how you install the Secure Workload Access (SWA) Server and SWA Agents on Kubernetes by using Helm charts.

## Before you begin

Make sure you meet these requirements before you start:

- A Kubernetes cluster for the SWA Server deployment
- Helm 3 installed on the machine where you run deployment commands
- The SWA Server and SWA Agent Helm charts are available on the installation machine
- SWA container images available in a container registry your cluster can reach
- An `authn_id` value from the SWA Server registration. For details, see [Register an SWA server](https://docs.cyberark.com/early-release/swa/en/content/conjurcloud/apis/ccl-api-swa-register-server.htm).

> **Note:**
>
> For Kubernetes deployments, use Helm as the primary installation method for the SWA Server and SWA Agents.

## Install the SWA Server

Install the SWA Server chart first so agents can connect to the server endpoint.

To install the SWA Server chart:

1. Run Helm install with your Secrets Manager - SaaS API endpoint and the SWA Server `authn_id`.

   Set `controlPlane.url` to your tenant base URL, for example `https://<subdomain>.secretsmgr.cyberark.cloud`. Set `controlPlane.auth.loginURL` to the `authn_id` value from the register-server response (the chart field name is `loginURL`).

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
2. Confirm that the SWA Server pod is running in the `swa-system` namespace.

## Install SWA Agents

Install SWA Agents as a DaemonSet so each node can provide workload identity services locally.

To install the SWA Agent chart:

1. Run Helm install for the SWA Agent chart.

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
2. Confirm that the SWA Agent pods are running on your workload nodes.

## Advanced Helm configuration

Use these options when you need to tune chart behavior beyond the minimal install commands.

### Why SWA uses separate charts

The SWA Server and the SWA Agent use separate charts because they have different deployment patterns, lifecycle requirements, and configuration inputs.

- The SWA Server runs as a Deployment and can scale independently.
- The SWA Agent runs as a DaemonSet and serves workloads on each node.
- The SWA Server requires control plane settings, while the SWA Agent requires server endpoint and node attestor settings.

### Key parameters

Set these parameters explicitly in your values or command-line overrides:

- Server chart: `controlPlane.url`, `controlPlane.auth.loginURL`, `rbac.createTokenReviewRole`, `trustDomain.name`, `image.repository`, and `image.tag`
- Agent chart: `trustDomain.name`, `server.address`, `nodeAttestor.k8s_psat.cluster`, `image.repository`, `image.tag`, and `podLabels.swa_nodegroup`

The `podLabels.swa_nodegroup` value must match your node group name and server group attestation settings. For design guidance, see [Design and assign SWA node groups](ccl-swa-node-groups-design.md).

### Node attestor options

For Kubernetes environments, use `k8s_psat`.

```
nodeAttestor:
  type: k8s_psat
  k8s_psat:
    cluster: <cluster-name>
    tokenPath: /var/run/secrets/kubernetes.io/serviceaccount/token
```

Use `x509pop` only when your environment requires certificate-based node attestation. To install SWA Agents on virtual machines or other machines outside the cluster, see [Install an SWA agent on a machine](ccl-swa-install-agent-machine.md).

```
helm install swa-agent ./swa-agent \
  --namespace swa-system \
  --set server.address=swa-server:8443 \
  --set nodeAttestor.type=x509pop \
  --set-file nodeAttestor.x509pop.cert=/path/to/agent.crt \
  --set-file nodeAttestor.x509pop.key=/path/to/agent.key
```

### Workload attestors

The SWA Agent can run multiple workload attestors. The common Kubernetes pattern uses both `unix` and `k8s`.

```
workloadAttestors:
  - type: unix
  - type: k8s
    config:
      nodeNameEnv: MY_NODE_NAME
```

If the `k8s` workload attestor reports kubelet certificate errors, especially on self-managed Kubernetes clusters, see [Troubleshoot Secure Workload Access (SWA)](ccl-swa-troubleshooting.md).

## Verify the deployment

Verify that both the SWA Server and the SWA Agent resources are healthy after installation.

To verify Helm deployment status:

1. Check Helm release status.

   ```
   helm list -n swa-system
   ```
2. Check pod status.

   ```
   kubectl get pods -n swa-system
   ```

For the end-to-end setup flow, see [Get started with SWA on Kubernetes](ccl-swa-getstarted-k8.md).

To install the SWA Terraform provider for declarative management of SWA control plane resources (trust domains, server groups, node groups, and similar), see [Install the SWA Terraform provider](ccl-swa-terraform-provider.md).
