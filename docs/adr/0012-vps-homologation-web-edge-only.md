# Allow a VPS web edge without weakening production custody

The operator supplied a small non-Azure VPS and the crmfarma.app.br domain for homologation. Publish only production-built static QG/customer-login assets and a Caddy TLS edge there; keep local synthetic dashboard routes separate, and return explicit 503 for the absent backend rather than running development auth or copying local secrets/ERP data.

This is a limited homologation deployment, not a replacement for the specified Azure managed-service architecture or M1 acceptance. Real auth/provisioning stays blocked until a reviewed deployment provides version-pinned Key Vault custody, managed identity and the existing role/process isolation. Stage on loopback while DNS is pending, preserve ACME state, expose only HTTP/HTTPS after DNS checks, and never infer backend readiness from web-edge health.
