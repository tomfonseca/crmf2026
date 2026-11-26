# Separate mutable network profile from provisioning identity

Keep `tenants.legal_name` as the existing registration/provisioning snapshot; an independently revisioned profile owns editable display name, registered company name, location and commercial contacts. Rewriting the legacy column would invalidate immutable queued/retry intent, while copying it into registered company name would assert an unverified legal fact. CNPJ/slug/plan are not edited by the profile operation, and its billing customer ID is a manual reference, never authority to charge.

CNPJ lookup is an authenticated, admin-only server adapter to BrasilAPI, not browser access to external registries. Only company name/trade name/city/UF suggestions cross the boundary; shareholder/contact payloads do not. Suggestions never create records, override manual edits, prove fiscal status, infer ERP timezone or prevent manual entry during provider failures.
