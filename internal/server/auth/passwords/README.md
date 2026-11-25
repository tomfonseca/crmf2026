# Common-password denylist

Public password corpus, not application credentials. No network access is needed at runtime.

Source: SecLists / Xato, pinned at commit `c205c36a445bff37f8e58a9ec829105cd4975c58`.
See `source.json` for the immutable URL, original checksum, selected checksum
and selection algorithm. `LICENSE` preserves the upstream MIT notice.

`common.txt` contains the first 100,000 distinct non-empty UTF-8 entries from
the one-million-entry source, in original order and with LF endings. The
100,000-entry upstream file contained an empty entry, so it was not used as
the final source. Loading rejects an incorrect entry count; tests pin the
content checksum. Membership checks also reject case variants.

Password creation requires at least 12 Unicode code points and at most 1,024
UTF-8 bytes. Password bytes are never trimmed or normalized for hashing.
Argon2id uses 64 MiB, three iterations, two lanes, a random 16-byte salt and a
32-byte key in PHC format. One reusable `Passwords` instance limits concurrent
Argon2 allocations to two; HTTP/IP throttling is separate, pending work.

Legacy hashes are accepted for verification only within bounded parameters;
a valid noncurrent hash is marked for rehash. Updating the stored password
hash revokes sessions, so the later login flow must persist any rehash
**before** issuing its new authenticated session.
