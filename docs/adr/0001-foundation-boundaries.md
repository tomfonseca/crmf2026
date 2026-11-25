# Foundation scope and local ERP isolation

The Go module starts as `github.com/crmf/crmf` until the repository owner is known.
M0 creates runnable infrastructure, health contracts and buildable CLI/UI shells;
business tables, authentication, tenancy and queue processing follow their stated
milestones rather than insecure placeholder implementations.

The local stack uses a separate MariaDB 10.6 instance with synthetic fixtures.
The restored MariaDB 10.4 database at `E:\\crmf\\db` is never mounted or modified by
this stack; it is a read-only evidence source for M2, not a CI fixture. Terraform
M0 creates only the hml foundation and remote-state bootstrap; managed application
resources are implemented before the corresponding deployment milestones.
