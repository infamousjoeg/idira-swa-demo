---
source: https://docs.cyberark.com/early-release/swa/en/content/conjurcloud/ccl-swa-terraform-provider.htm
title: Install the SWA Terraform provider
---

# Install the SWA Terraform provider

This topic describes how to install and verify the Secure Workload Access (SWA) Terraform provider so you can manage SWA resources with Terraform, and how the provider authenticates to Secrets Manager - SaaS so you can run `terraform plan` and `terraform apply` against your tenant.

> **Note:**
>
> Simple reference documentation for the provider ships in the same bundle as the Terraform provider binary. After you extract the bundle, open the `docs` folder (for example, `docs/index.md`) for resource and data source details.

## Before you begin

Make sure you meet these requirements before you start:

- Terraform version 1.0 or later
- Access to CyberArk Marketplace to download the provider binary
- An active Secrets Manager tenant with Secure Workload Access enabled

> **Note:**
>
> This provider is not published to the public Terraform Registry. You install the binary in the local Terraform plugin path.

## Supported platforms

Use a provider binary that matches your operating system and CPU architecture.

Supported Terraform provider platforms

| Platform | Architecture | Terraform target |
| --- | --- | --- |
| Linux | x86\_64 (AMD64) | `linux_amd64` |
| Linux | ARM64 (AArch64) | `linux_arm64` |
| macOS | Intel | `darwin_amd64` |
| macOS | Apple Silicon | `darwin_arm64` |
| Windows | x86\_64 (AMD64) | `windows_amd64` |

## Install the provider

Use this workflow to install the Secure Workload Access (SWA) Terraform provider and configure Terraform to use it.

Terraform expects this provider in the local mirror path under `registry.terraform.io/cyberark/swa`.

To install the SWA Terraform provider:

1. Download the provider binary for your operating system and architecture from [CyberArk Marketplace](https://cyberark.com/marketplace).

   The binary name format is `terraform-provider-swa_v<version>` for Linux and macOS, and `terraform-provider-swa_v<version>.exe` for Windows.
2. Create the local plugin directory.

   ```
   mkdir -p ~/.terraform.d/plugins/registry.terraform.io/cyberark/swa/<version>/<os>_<arch>
   ```

   Replace `<version>` with your provider version and `<os>_<arch>` with your platform value, for example `linux_amd64`, `darwin_arm64`, or `windows_amd64`.
3. Copy the provider binary into that directory and make it executable.

   ```
   cp terraform-provider-swa_v<version> ~/.terraform.d/plugins/registry.terraform.io/cyberark/swa/<version>/<os>_<arch>/terraform-provider-swa_v<version>
   chmod +x ~/.terraform.d/plugins/registry.terraform.io/cyberark/swa/<version>/<os>_<arch>/terraform-provider-swa_v<version>
   ```

   ```
   $VERSION = "<version>"

   New-Item -ItemType Directory -Force -Path "$env:APPDATA\terraform.d\plugins\registry.terraform.io\cyberark\swa\$VERSION\windows_amd64"

   Copy-Item "terraform-provider-swa_v$VERSION.exe" -Destination "$env:APPDATA\terraform.d\plugins\registry.terraform.io\cyberark\swa\$VERSION\windows_amd64\terraform-provider-swa_v$VERSION.exe"
   ```
4. Declare the provider in your Terraform configuration with an exact version.

   ```
   terraform {
     required_providers {
       swa = {
         source  = "cyberark/swa"
         version = "<version>"
       }
     }
   }
   ```

   Pin the exact version that matches the installed binary.
5. Run `terraform init` in your Terraform project directory.

> **Note:**
>
> On Windows, use `%APPDATA%\terraform.d\plugins\` instead of `~/.terraform.d/plugins/`.

> **Note:**
>
> On macOS, the first `terraform init` might fail because macOS quarantines binaries downloaded from outside the App Store. If you see a "developer cannot be verified" dialog, or `terraform init` exits with `killed` or `code signature invalid` on Apple Silicon, see [macOS blocks the binary](#MacOS_blocks_binary) in Troubleshoot common issues.

## Verify the installation

Confirm that Terraform detects the local Secure Workload Access (SWA) provider.

To verify the provider:

1. Run `terraform init`.
2. Confirm that the output shows `Installing cyberark/swa v<version>` and `Installed cyberark/swa v<version>`.
3. Run `terraform providers` and confirm that it lists `registry.terraform.io/cyberark/swa` with your pinned version.

## Authenticate the provider to Secrets Manager - SaaS

The SWA provider sends requests to the Secrets Manager - SaaS API using a Secrets Manager access token. This matches SWA REST requests, which use a header such as `Authorization: Token token="<token>"`.

For more details, see [Authenticate workloads](https://docs.cyberark.com/early-release/swa/en/content/developer/conjur_api_authenticate.htm) and [Authenticate user](https://docs.cyberark.com/early-release/swa/en/content/developer/conjur_api_authenticate_user.htm).

Use Developer access when you run `terraform plan` or `terraform apply` on a local workstation. Use Machine and workload access for CI/CD pipelines, build agents, and other non-interactive hosts.

### Developer access

Authenticate on your development machine before you run Terraform against your tenant.

#### Primary: Secrets Manager CLI

> **Note:**
>
> Preferred for developers: use the Secrets Manager CLI to log in and store credentials before you run Terraform.

Sign in once, then run Terraform without setting provider credentials in your configuration. For CLI setup, see [init](https://docs.cyberark.com/early-release/swa/en/content/conjurcloud/cli/cli-init.htm) and [login](https://docs.cyberark.com/early-release/swa/en/content/conjurcloud/cli/cli-login.htm).

Initialize the CLI for Secrets Manager - SaaS and then sign in:

```
conjur init saas -u https://<subdomain>.secretsmgr.cyberark.cloud/
conjur login
```

The `<subdomain>` segment in `https://<subdomain>.secretsmgr.cyberark.cloud` is your tenant subdomain.

Then use an empty provider block:

```
provider "swa" {}
```

#### Fallback: Static credentials

Use static credentials when the Secrets Manager CLI is not available or you cannot run an interactive login.

Static access token: Set a static access token and tenant URL in the environment. Then use an empty provider block.

On Linux or macOS, run the following commands:

```
export CONJUR_APPLIANCE_URL="https://<subdomain>.secretsmgr.cyberark.cloud"
export CONJUR_AUTHN_TOKEN="<access-token>"
```

On Windows, run the following commands in PowerShell:

```
$env:CONJUR_APPLIANCE_URL = "https://<subdomain>.secretsmgr.cyberark.cloud"
$env:CONJUR_AUTHN_TOKEN = "<access-token>"
```

```
provider "swa" {}
```

Explicit provider configuration: Use this approach when you obtain a token outside the provider (for example from a secret store) and pass it using a sensitive variable.

```
provider "swa" {
  url          = "https://<subdomain>.secretsmgr.cyberark.cloud"
  access_token = var.conjur_access_token
}

variable "conjur_access_token" {
  type        = string
  description = "Secrets Manager access token"
  sensitive   = true
}
```

API key: You can authenticate with an API key by setting `CONJUR_AUTHN_LOGIN`, `CONJUR_AUTHN_API_KEY`, and `CONJUR_ACCOUNT`. This is an additional static fallback when CLI login is not practical.

On Linux or macOS, run the following commands:

```
export CONJUR_APPLIANCE_URL="https://<subdomain>.secretsmgr.cyberark.cloud"
export CONJUR_ACCOUNT="<account>"
export CONJUR_AUTHN_LOGIN="<login>"
export CONJUR_AUTHN_API_KEY="<api-key>"
```

On Windows, run the following commands in PowerShell:

```
$env:CONJUR_APPLIANCE_URL = "https://<subdomain>.secretsmgr.cyberark.cloud"
$env:CONJUR_ACCOUNT = "<account>"
$env:CONJUR_AUTHN_LOGIN = "<login>"
$env:CONJUR_AUTHN_API_KEY = "<api-key>"
```

```
provider "swa" {}
```

### Machine and workload access

Authenticate non-interactive runners (for example CI/CD pipelines and automation hosts) without using the Secrets Manager CLI login flow.

#### Primary: JWT authentication

> **Note:**
>
> Preferred for pipelines and automated runs: use JWT authenticator environment variables so the provider obtains an access token from a workload JWT.

Set the tenant URL, account, and JWT authenticator variables in your pipeline or host environment. Map your CI platform identity token to `CONJUR_AUTHN_JWT_TOKEN` (for example a GitLab `id_tokens` value). Use `CONJUR_AUTHN_JWT_HOST_ID` when your authenticator requires a host-scoped identity.

Required variables for SaaS:

- `CONJUR_APPLIANCE_URL`: your tenant base URL (for example `https://<subdomain>.secretsmgr.cyberark.cloud`)
- `CONJUR_ACCOUNT`: your Secrets Manager account name
- `CONJUR_AUTHN_JWT_SERVICE_ID`: the JWT authenticator name without the `authn-jwt/` prefix (for example `gitlab`, not `authn-jwt/gitlab`)
- `CONJUR_AUTHN_JWT_TOKEN`: the JWT presented by the workload or CI job

Example for a generic pipeline (Linux or macOS agent):

```
export CONJUR_APPLIANCE_URL="https://<subdomain>.secretsmgr.cyberark.cloud"
export CONJUR_ACCOUNT="<account>"
export CONJUR_AUTHN_JWT_SERVICE_ID="<service-id>"
export CONJUR_AUTHN_JWT_TOKEN="<jwt-from-ci-platform>"
```

Then use an empty provider block:

```
provider "swa" {}
```

In CI, do not set authentication variables for other methods (for example `CONJUR_AUTHN_TOKEN` or API key variables) unless you intend the provider to use them. The client library uses the first method for which the required variables are present.

For GitLab CI, see [GitLab](https://docs.cyberark.com/early-release/swa/en/content/integrations/gitlab.htm). For authenticator setup and constraints, see [Important guidelines for configuring JWT authentication](https://docs.cyberark.com/early-release/swa/en/content/operations/services/cjr-authn-jwt-guidelines.htm).

#### Fallback: Static credentials

Use static credentials when JWT authentication is not available in the pipeline (for example the runner cannot obtain an identity token, or policy does not yet grant JWT access).

Static access token: Store a pre-issued access token in your CI secret store and set `CONJUR_AUTHN_TOKEN` and `CONJUR_APPLIANCE_URL` before Terraform runs. See [Static access token: Set a static access token and tenant URL in the environment. Then use an empty provider block.](#Static_access) under Developer access.

Explicit provider configuration: Pass a token from an earlier pipeline stage using a sensitive Terraform variable (for example when a bootstrap job mints the token). See [Explicit provider configuration: Use this approach when you obtain a token outside the provider (for example from a secret store) and pass it using a sensitive variable.](#Explicit_prov) under Developer access.

### Credential resolution

When `access_token` is not set in the provider block, the Secrets Manager client library selects an authentication method from the environment and stored configuration. The sections above describe recommended choices for developers and for machines. The list below is the technical resolution order the library follows:

1. Explicit configuration: Set `url`, `access_token`, or both in the `provider "swa"` block. Each argument is optional. You can set `url` alone and rely on automatic authentication for the token, or set `access_token` alone and supply the tenant URL through `CONJUR_APPLIANCE_URL` or the Secrets Manager CLI configuration file.
2. Automatic authentication: If you do not set `access_token` in the provider block, the provider uses the Secrets Manager client library to select an available method, including the following:

   - Token file: `CONJUR_AUTHN_TOKEN_FILE`
   - Static token: `CONJUR_AUTHN_TOKEN`
   - Client certificate (mTLS): `CONJUR_AUTHN_CERT_SERVICE_ID`
   - JWT: `CONJUR_AUTHN_JWT_SERVICE_ID`, `CONJUR_AUTHN_JWT_TOKEN`, and optionally `CONJUR_AUTHN_JWT_HOST_ID`
   - API key: `CONJUR_AUTHN_LOGIN` and `CONJUR_AUTHN_API_KEY`
   - Stored credentials from the Secrets Manager CLI: for example Secrets Manager - SaaS, OIDC, and cloud identity flows after you run `conjur login`

Which method runs in practice depends on which variables are set in your environment (developer workstation, CI agent, or workload host). Recommended paths above (CLI for developers, JWT for pipelines) reflect best practice; they do not change this library order. In CI, unset variables for methods you do not want so JWT or static credentials are selected intentionally.

> **Note:**
>
> Set `CONJUR_APPLIANCE_URL` to your tenant base URL, for example `https://<subdomain>.secretsmgr.cyberark.cloud`, where `<subdomain>` is your Secrets Manager tenant subdomain. You can also set `url` in the provider block or rely on values from the Secrets Manager CLI configuration file after [init](https://docs.cyberark.com/early-release/swa/en/content/conjurcloud/cli/cli-init.htm).

### Provider arguments

Optional arguments for the SWA provider block

| Argument | Description |
| --- | --- |
| `access_token` (optional, sensitive) | Static access token. If unset, the provider authenticates automatically using the methods in Developer access, Machine and workload access, and Credential resolution (environment variables, CLI configuration, and stored credentials). |
| `url` (optional) | Base URL for Secrets Manager - SaaS (for example, `https://<subdomain>.secretsmgr.cyberark.cloud`). You can set `CONJUR_APPLIANCE_URL` instead or rely on the Secrets Manager CLI configuration file. |

> **Note:**
>
> Field-level schemas for the provider also appear in the bundle `docs` folder (for example, `docs/index.md`). For developer access with the Secrets Manager CLI, you typically do not need to set `access_token` or `url` in Terraform after `conjur login`.

## Upgrade the provider

Use this workflow when you move to a new Secure Workload Access (SWA) provider version.

To upgrade the provider:

1. Download the new provider version from [CyberArk Marketplace](https://cyberark.com/marketplace).
2. Install the new binary in a version-specific directory under the local plugin path.
3. Update `required_providers.swa.version` to the new value.
4. Delete `.terraform` and `.terraform.lock.hcl`. Run `terraform init` again.

## Troubleshoot common issues

Use these checks if Terraform does not load the Secure Workload Access (SWA) provider. For issues with the SWA Agent deployment or workload attestation on Kubernetes (for example, kubelet TLS), see [Troubleshoot Secure Workload Access (SWA)](ccl-swa-troubleshooting.md).

### Provider not found

If `terraform init` cannot find `cyberark/swa`, verify the plugin path and version values.

To resolve a provider not found error:

1. Verify the directory path uses lowercase values for `registry.terraform.io/cyberark/swa`.
2. Verify the folder version matches the version in `required_providers`.
3. Delete `.terraform` and `.terraform.lock.hcl`.
4. Run `terraform init` again.

### Wrong architecture

If Terraform reports an incompatible provider binary, install a binary that matches your operating system and CPU architecture. Run `terraform init` again.

### Permission denied

If Terraform cannot execute the binary, set execute permissions on Linux or macOS. Run `terraform init` again.

### macOS blocks the binary

If macOS shows a "developer cannot be verified" dialog, or Terraform exits with `killed` or `code signature invalid` on Apple Silicon, remove the quarantine attribute that macOS applies to downloaded files. The provider is distributed through CyberArk Marketplace rather than the public Terraform Registry, so macOS treats the binary as untrusted on first run.

Use one of the following methods. Apply the change only to the provider binary.

- Remove the quarantine attribute on the binary: Run the following command.

  ```
  xattr -d com.apple.quarantine ~/.terraform.d/plugins/registry.terraform.io/cyberark/swa/<version>/<os>_<arch>/terraform-provider-swa_v<version>
  ```
- Open the binary in Finder: Locate the binary, right-click, and select Open. Confirm the prompt once.
- Add the binary to the system trust list: Run the following command.

  ```
  spctl --add ~/.terraform.d/plugins/registry.terraform.io/cyberark/swa/<version>/<os>_<arch>/terraform-provider-swa_v<version>
  ```

> **Note:**
>
> Do not run `xattr -rd com.apple.quarantine` against the plugin directory or use `sudo`. Recursive removal strips quarantine from unrelated files, and `sudo` is not required to modify files you own.

Run `terraform init` again.

### Version mismatch

If Terraform reports no matching version for `cyberark/swa`, align the pinned version with an installed local version.

To resolve a version mismatch:

1. List installed versions under `~/.terraform.d/plugins/registry.terraform.io/cyberark/swa/` or `%APPDATA%\terraform.d\plugins\registry.terraform.io\cyberark\swa\`.
2. Update `required_providers.swa.version` to a listed version.
3. Run `terraform init` again.

### Stale lock file

If `.terraform.lock.hcl` contains old checksums, delete the lock file and reinitialize.

```
rm .terraform.lock.hcl
terraform init
```

For SWA setup context, see [Secure workloads with SWA](ccl-getstarted-swa-lp.md). After you configure server groups and node groups, see [Install an SWA agent on a machine](ccl-swa-install-agent-machine.md). For SWA REST endpoints, see [Secure Workload Access APIs](https://docs.cyberark.com/early-release/swa/en/content/conjurcloud/apis/ccl-api-swa-lp.htm). For platform integration, see [Integrate external platforms](https://docs.cyberark.com/early-release/swa/en/content/conjurcloud/ccl-cloud-platforms-lp.htm).
