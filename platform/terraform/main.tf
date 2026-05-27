terraform {
  required_version = ">= 1.5"
  required_providers {
    swa = {
      source  = "cyberark/swa"
      # Pin to the bundled version (verified via `install-terraform-provider.sh`
      # output). The bundled binary is the only published artifact — there is
      # no public registry release.
      version = "0.1.0-0d54f57b-758"
    }
    external = {
      source  = "hashicorp/external"
      version = "~> 2.3"
    }
    # M2: Conjur policy / variables / authn-jwt are managed by the public
    # cyberark/conjur provider (the bundled cyberark/swa provider does NOT
    # ship those resources — see SCHEMA.md and spec §7.1 (AMENDED 2026-05-27)).
    conjur = {
      source  = "cyberark/conjur"
      # Pin: v0.8.x is the first line that ships managed resources
      # (conjur_authenticator, conjur_branch, conjur_host, conjur_secret, etc.).
      # The 0.6.x line is data-source-only and cannot manage policy.
      version = "~> 0.8.4"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

# Providers authenticate via env vars set by `make tf-token`:
#   CONJUR_APPLIANCE_URL = https://<sm-tenant>.secretsmgr.cyberark.cloud
#   CONJUR_AUTHN_TOKEN   = base64 SM access token (from scripts/get-sm-token.sh,
#                          which is in turn wrapped in `summon -p conceal_summon`)
# Both come from the Makefile — never source secrets in HCL.
provider "swa" {}
provider "conjur" {}
