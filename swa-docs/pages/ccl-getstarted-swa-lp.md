---
source: https://docs.cyberark.com/early-release/swa/en/content/conjurcloud/ccl-getstarted-swa-lp.htm
title: Secure workloads with SWA
---

# Secure workloads with SWA

This section describes how to deploy Secure Workload Access (SWA) and configure workload identity. Use SWA to enable workloads to authenticate and retrieve secrets with SPIFFE-based identities.

For external platform federation, dynamic secrets, and Secrets Manager JWT setup, see [Integrate external platforms](https://docs.cyberark.com/early-release/swa/en/content/conjurcloud/ccl-cloud-platforms-lp.htm).

## Plan SWA

Review these topics to understand how Secure Workload Access (SWA) and SPIFFE work, key terms, and architecture context.

- [Secure workload identities with SPIFFE and SWA](ccl-swa-overview.md)
- [Design and assign SWA node groups](ccl-swa-node-groups-design.md)
- [SPIFFE templates, attestors, and registration policies for SWA](ccl-swa-node-groups-templates-policies.md)

## Deploy SWA

Choose a deployment method to set up Secure Workload Access (SWA) infrastructure in your environment.

### Terraform provider

- [Install the SWA Terraform provider](ccl-swa-terraform-provider.md)

### Kubernetes

- [Get started with SWA on Kubernetes](ccl-swa-getstarted-k8.md)
- [Install SWA on Kubernetes with Helm](ccl-swa-install-helm.md)
- [Troubleshoot Secure Workload Access (SWA)](ccl-swa-troubleshooting.md)

### Virtual machines

- [Install an SWA agent on a machine](ccl-swa-install-agent-machine.md)

## Configure integrations

Configure OIDC issuer and JWT settings that SWA integrations use before or alongside platform setup. To retrieve secrets from Secrets Manager with JWT-SVIDs, complete the authenticator procedure after you review the JWT requirements topic.

- [Configure OIDC issuer values for SWA integrations](ccl-swa-oidc.md)
- [Configure JWT requirements for SWA integrations](ccl-swa-jwt.md)
- [Integrate SWA with Secrets Manager JWT authentication](cjr-authn-jwt-swa.md)

## See also

- For external platform federation, dynamic secrets, and Secrets Manager JWT setup by cloud provider, see [Integrate external platforms](https://docs.cyberark.com/early-release/swa/en/content/conjurcloud/ccl-cloud-platforms-lp.htm).
- For the legacy AWS IAM Authenticator, see [Authenticate AWS resources](https://docs.cyberark.com/early-release/swa/en/content/operations/authn/authenticate-awsiam-lp.htm).
- For the legacy Azure Authenticator, see [Authenticate Azure resources](https://docs.cyberark.com/early-release/swa/en/content/operations/authn/authenticate-azure-lp.htm).
