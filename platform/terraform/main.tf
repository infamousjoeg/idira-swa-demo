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
  }
}

# Provider authenticates via env vars set by `make tf-token`:
#   CONJUR_APPLIANCE_URL = https://<sm-tenant>.secretsmgr.cyberark.cloud
#   CONJUR_AUTHN_TOKEN   = base64 SM access token (from scripts/get-sm-token.sh,
#                          which is in turn wrapped in `summon -p conceal_summon`)
# Both come from the Makefile — never source secrets in HCL.
provider "swa" {}
