variable "trust_domain" {
  description = "SPIFFE trust domain. Becomes the SVID URI authority (spiffe://<this>/...)."
  type        = string
  default     = "idira.demo"
}

variable "server_group" {
  description = "SWA server group name. Scopes a node attestor (k8s_psat for in-cluster install)."
  type        = string
  default     = "kind-sg"
}

variable "node_group" {
  description = "SWA node group name. Must match podLabels.swa_nodegroup in the agent values."
  type        = string
  default     = "kind-ng"
}

variable "server_name" {
  description = "SWA server registration name. Used in the chart's controlPlane.auth.loginURL via SWA_AUTHN_ID."
  type        = string
  default     = "swa-server-kind"
}

variable "kind_cluster" {
  description = "Logical cluster name shared between SWA server (k8s_psat.clusters key) and agent (nodeAttestor.k8s_psat.cluster). Free-form string; both sides must match."
  type        = string
  default     = "kind-swa"
}

variable "swa_namespace" {
  description = "Kubernetes namespace where swa-server + swa-agent run. Used to scope SA allow-list and server JWT subject."
  type        = string
  default     = "swa-system"
}

variable "swa_server_sa" {
  description = "Service account name for the swa-server pod. Matches helm chart fullname default when release name is 'swa-server'."
  type        = string
  default     = "swa-server"
}

variable "swa_agent_sa" {
  description = "Service account name for the swa-agent pod. Matches helm chart fullname default when release name is 'swa-agent'."
  type        = string
  default     = "swa-agent"
}

variable "sm_url" {
  description = "Secrets Manager – SaaS base URL (no trailing slash). Used to compute the JWT authenticator's issuer and jwks_uri. Passed via -var from the Makefile."
  type        = string
}
