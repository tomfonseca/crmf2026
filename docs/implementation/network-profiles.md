# Network commercial profile and CNPJ suggestions

M1 increment; does not complete Lojas, pairing, invitations, billing or M1 acceptance.

## Contract and persistence

- Forward-only control migration **00011** creates restricted `core.network_profiles`.
- `POST /v1/hq/tenants` optionally accepts `profile`, with eight string members:
  `display_name`, `registered_name`, `city`, `uf`, `contact_name`, `contact_email`,
  `default_timezone`, `billing_customer_id`. Empty means unknown/unconfigured.
  Legacy four-field requests remain valid. New registration persists metadata,
  reservation/subscription, queue request and actor audit in the same transaction.
- Responses/list optionally include `profile: {data, version}`. Missing legacy
  profiles are unknown, never seeded with guessed company name/city/timezone.
  Listing fetches profiles in one bounded query, not one query per network.
- `PUT /v1/hq/tenants/{id}/profile` accepts the complete `{data, version}`; version
  zero initializes legacy metadata. Slug-scoped transaction locks plus actual
  revision checks reject lost updates (409); a database trigger owns increments.
  Audit contains actor/network/version, not contact/CNPJ data.
- Admin writes/support reads. Exact origin/custom mutation header, fresh opaque
  session scope, strict <=8KiB JSON/no nested duplicate/null/unknown/missing profile
  members. Invalid text, UF, email and IANA America timezone fail validation.
- Original `legal_name` remains the immutable queued registration name; editable
  display name is separate. CNPJ, slug and linked plan cannot be mutated here.
  See [ADR 0008](../adr/0008-network-profile-and-company-suggestions.md).

## CNPJ lookup

`GET /v1/hq/companies/{cnpj}` requires a platform administrator and uses only the
fixed HTTPS BrasilAPI CNPJ-v1 host/path. Canonical 12 uppercase alphanumeric + two
numeric check-character syntax follows the existing registration contract and
provider docs; this is **not** local checksum/fiscal verification.

- Provider reference: https://github.com/BrasilAPI/BrasilAPI/blob/main/pages/docs/doc/cnpj.json
  and https://brasilapi.com.br/docs#tag/CNPJ.
- Only CNPJ is sent to the provider. No session cookies, bearer credentials,
  contacts, tenant IDs or request-selected host/URL. Redirects refused; 5s client
  deadline; <=256KiB response reader; max four concurrent requests and six attempts
  per authenticated operator/minute. Rate map is bounded to 1024 live windows.
- Decode only CNPJ/company name/trade name/city/UF; require matching CNPJ, valid
  metadata and nonempty company name. Never forward/cache/log raw upstream JSON,
  shareholder identities, documents, phone numbers or emails.
- 404/429/unavailable/cancellation are distinct from successful suggestions.
  Provider outage is not “CNPJ inválido” and never blocks manual registration.
- UI automatically queries on completion of canonical CNPJ, plus explicit retry.
  It fills only empty fields, cancels on CNPJ changes/unmount, discards stale
  responses and clears previous suggestions only if not manually edited. Name,
  registered name and location remain editable. Contacts/timezone/billing ID are
  never derived from provider data. Review suggestions before saving.
- Default timezone is an explicit choice for subsequent store forms, not proof
  of source timezone and not retroactive modification of existing stores.
- Commercial contact does not enroll an administrator or send invitations;
  billing ID does not create a gateway customer/subscription or charge anything.

## Evidence

Real PostgreSQL/HTTPS tests cover atomic creation, exact registration replay,
profile round trip, revision conflicts, CSRF, unchanged provisioning identity,
audit actor, support and revoked-grant denial. Synthetic transport tests cover
projection, wrong identity, redirects/status/malformed/oversized responses and
cancellation without querying real companies. Browser contracts cover automatic
formatted CNPJ entry, manual-name preservation, all eight fields, edit round
trip, immutable fields, exactly two mutations and no business storage. Unit tests
also control out-of-order responses and unmount abort without sleeps/retries.

External provider availability/data accuracy, native operator authentication,
Azure egress configuration and human visual approval are separate acceptance;
intercepted browser contracts are not evidence of those properties.
