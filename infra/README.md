# Terraform foundation

M0 includes a remote-state bootstrap and the hml resource group in Brazil South.
It does not provision the full section 12 infrastructure yet.

1. Authenticate using Azure OIDC (CI) or Azure CLI (local). Set ARM_SUBSCRIPTION_ID,
   ARM_TENANT_ID and ARM_CLIENT_ID as appropriate; never commit credentials.
2. Bootstrap only once: `terraform -chdir=infra/bootstrap init`, then
   `terraform -chdir=infra/bootstrap apply -var=storage_account_name=<unique-name>`.
   Keep the bootstrap state secure; it is intentionally local for the initial
   remote-state chicken-and-egg. Grant the operator Storage Blob Data Contributor
   on the state account before creating the container; control-plane Contributor
   alone does not grant data-plane access. Bootstrap may need a second apply
   after this RBAC assignment has propagated.
3. Copy hml/backend.hcl.example and terraform.tfvars.example to untracked local
   config, fill real values, and run init with `-backend-config=<path>`.
4. Inspect `terraform plan` before any apply. No cloud resources are created by
   `make dev`, local tests, or the validation-only M0 GitHub workflow.

The hml Azure plan step runs only when the OIDC repository variables and state
configuration are present. Production deployment and the remaining modules are
future milestones, not mock deployments.
