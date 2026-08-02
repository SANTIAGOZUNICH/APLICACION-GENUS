# 0017 deferred migration plan

`0016_genus_auth` is already the Genus Auth migration and is intentionally unchanged.

`0017_creamy_userid_notif_idempotency.sql` is additive and remains deferred until an
explicit Preview authorization sets `APPLY_MIGRATION_0017=1`. It adds
`creamy_user_memories.user_id` for stable session ownership. Approval notifications
use deterministic UUID primary keys, so no idempotency column is needed.
