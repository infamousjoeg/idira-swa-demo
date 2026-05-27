---
source: https://docs.cyberark.com/early-release/swa/en/content/conjurcloud/ccl-swa-install-agent-machine.htm
title: Install an SWA agent on a machine
---

# Install an SWA agent on a machine

This topic describes how you install a Secure Workload Access (SWA) Agent on a virtual machine (VM) or other machine that runs an SSH server. The SWA Server runs on Kubernetes. You use X.509 proof-of-possession (`x509pop`) node attestation, the SWA REST API, and Ansible to register the agent with that server.

## Before you begin

Make sure you meet these requirements before you start:

- A trust domain for your SWA deployment (if you need to create one, run only the trust-domain curl in Step 1: Create SWA resources in [Get started with SWA on Kubernetes](ccl-swa-getstarted-k8.md))
- A Kubernetes cluster where you deploy the SWA Server
- Network connectivity from each agent machine to the SWA Server endpoint
- One or more target machines with an SSH server (for example, a Linux VM) and sudo access for the Ansible user
- Ansible on a control machine where you run playbooks
- Secrets Manager Admin role and an access token for SWA API calls (see [Authenticate user](https://docs.cyberark.com/early-release/swa/en/content/developer/conjur_api_authenticate_user.htm))
- The `swa-agent` binary and Ansible roles from your SWA artifact bundle (extract the `swa-agent` archive from the `release` folder in the bundle)

> **Note:**
>
> For `x509pop` design context and how node group names map to certificate Subject CNs, see [Design and assign SWA node groups](ccl-swa-node-groups-design.md).

## Generate the x509pop CA certificate

Generate a certificate authority (CA) private key and a self-signed CA certificate that you use to attest SWA Agents on your machines.

To generate the CA key and certificate:

1. Generate the CA private key.

   ```
   openssl genrsa -out ca.key 4096
   ```
2. Generate the self-signed CA certificate.

   ```
   openssl req -new -x509 -days 3650 -key ca.key -out ca.crt \
     -subj "/CN=SWA Node Attestation CA"
   ```

> **Note:**
>
> Keep `ca.key` secure. You use it to sign agent certificates. Use a dedicated intermediate CA for SWA node certificates rather than your organization's root CA.

## Configure SWA resources with the REST API

Create a server group, register and install an SWA Server in that group, then create a node group for your machines. Set shell variables `SWA_API_BASE`, `TOKEN`, `TRUST_DOMAIN_NAME`, `SERVER_GROUP_NAME`, `SERVER_NAME`, and `NODE_GROUP_NAME` as in [Get started with SWA on Kubernetes](ccl-swa-getstarted-k8.md).

### Create a server group

Embed the CA certificate from the previous section in `node_attestation.x509pop.ca_certificates`. Format the PEM from `ca.crt`, then run:

```
export CA_CERT_PEM=$(awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}' ca.crt)

curl -sS -X POST "${SWA_API_BASE}/api/swa/trust-domains/${TRUST_DOMAIN_NAME}/server-groups" \
    -H "Authorization: Token token=\"${TOKEN}\"" \
    -H "Accept: application/x.secretsmgr.v2+json" \
    -H "Content-Type: application/json" \
    -d '{
        "name": "'"${SERVER_GROUP_NAME}"'",
        "description": "Application server group",
        "node_attestation": {
            "x509pop": {
                "ca_certificates": "'"${CA_CERT_PEM}"'"
            }
        }
    }'
```

For all available fields and full response details, see [Create a server group](https://docs.cyberark.com/early-release/swa/en/content/conjurcloud/apis/ccl-api-swa-create-server-group.htm).

Save the server group `name`. You use it when you register the SWA Server.

### Register and install the SWA Server

Follow [Get started with SWA on Kubernetes](ccl-swa-getstarted-k8.md) to register and install the SWA Server in `SERVER_GROUP_NAME`. Use Step 2 and the SWA Server install in Step 3 only. Do not run the server group or node group commands in Step 1 of that topic. Skip the Kubernetes node group and SWA Agent Helm steps in that topic.

### Create a node group

After the SWA Server is running, associate a node group with the server group and set `workload_type` to `unix` for machine workloads.

```
curl -sS -X POST "${SWA_API_BASE}/api/swa/trust-domains/${TRUST_DOMAIN_NAME}/server-groups/${SERVER_GROUP_NAME}/node-groups" \
    -H "Authorization: Token token=\"${TOKEN}\"" \
    -H "Accept: application/x.secretsmgr.v2+json" \
    -H "Content-Type: application/json" \
    -d '{
        "name": "'"${NODE_GROUP_NAME}"'",
        "description": "Unix workload node group with defaults",
        "workload_type": "unix"
    }'
```

For all available fields and full response details, see [Create node group](https://docs.cyberark.com/early-release/swa/en/content/conjurcloud/apis/ccl-api-swa-create-node-group.htm).

The Subject CN in each agent certificate must match the node group `name` exactly (for example, `unix-nodegroup-1`). The SWA Server uses that value during `x509pop` attestation to assign the node to the node group.

## Install the SWA Agent with Ansible

Use Ansible to copy agent certificates to each machine and install the SWA Agent binary.

### Define the inventory

Create an inventory file that points to your target machines.

```
all:
  children:
    nodes:
      hosts:
        my-vm:
          ansible_host: <vm-ip>
          ansible_user: <user>
```

### Generate an x509pop certificate per agent

For each agent, generate a key pair and a certificate signed by the CA. Set the CSR Subject CN to `NODE_GROUP_NAME` (the node group you created earlier).

```
# Generate agent private key
openssl genrsa -out agent.key 2048

# Generate CSR (CN must match NODE_GROUP_NAME)
openssl req -new -key agent.key -out agent.csr \
  -subj "/CN=${NODE_GROUP_NAME}"

# Sign with the CA
openssl x509 -req -days 365 -in agent.csr \
  -CA ca.crt -CAkey ca.key -CAcreateserial -out agent.crt
```

You can run these commands as tasks in your playbook before the roles copy certificates to each host.

### Run the Ansible playbook

Use the `copyx509pop-agent` and `swa-agent` roles from your artifact bundle. Set `swa_agent_servers` to the address agents use to reach the SWA Server and `bundle_source_url` to your tenant SWA CA bundle endpoint.

```
---
- name: Install SWA Agent
  hosts: nodes
  gather_facts: true
  become: true
  vars:
    swa_agent_log_level: "debug"
    swa_agent_binary: "<path-to-swa-agent-binary-from-artifact-bundle>"
    node_attestation_type: x509pop
    swa_agent_x509pop_cert: "/etc/swa/x509pop.cert"
    swa_agent_x509pop_key: "/etc/swa/x509pop.key"
    swa_agent_servers:
      - addr: "<IP/host for the server>:8443"
    swa_trust_domain: "<trust-domain-name>"
    bundle_source_url: "https://<tenant-base-url>/api/swa/trust-domains/{{ swa_trust_domain }}/.well-known/ca-bundles"
  roles:
    - copyx509pop-agent
    - swa-agent
```

To install agents with Ansible:

1. Save the playbook and inventory files on your control machine.
2. Run the playbook against your inventory.

   ```
   ansible-playbook -i inventory.yml swa-playbook.yml
   ```

For Unix workload attestor defaults in the Ansible role, see [SPIFFE templates, attestors, and registration policies for SWA](ccl-swa-node-groups-templates-policies.md).

## Verify the installation

Confirm that the SWA Agent service is running and can reach the SWA Server.

To verify agent status on a target machine:

1. Check the agent service status.

   ```
   sudo systemctl status swa-agent
   sudo journalctl -u swa-agent -f
   ls -la /run/swa-agent/api.sock
   ```
2. Optionally, fetch a JWT SVID from the agent Workload API socket.

   ```
   /opt/swa/bin/swa-agent api fetch jwt \
     --audience conjur \
     --socketPath /run/swa-agent/api.sock
   ```

From the Ansible control machine, you can run ad hoc checks instead of SSH to each host:

```
ansible my-vm -i inventory.yml -a "sudo systemctl status swa-agent"
ansible my-vm -i inventory.yml -a "ls -la /run/swa-agent/api.sock"
```

## See also

- [Get started with SWA on Kubernetes](ccl-swa-getstarted-k8.md)
- [Install SWA on Kubernetes with Helm](ccl-swa-install-helm.md)
- [Install the SWA Terraform provider](ccl-swa-terraform-provider.md)
- [Design and assign SWA node groups](ccl-swa-node-groups-design.md)
- [Troubleshoot Secure Workload Access (SWA)](ccl-swa-troubleshooting.md)
- [Secure workloads with SWA](ccl-getstarted-swa-lp.md)
