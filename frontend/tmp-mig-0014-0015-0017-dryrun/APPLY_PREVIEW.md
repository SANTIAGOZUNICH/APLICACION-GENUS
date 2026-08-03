# Preview apply — 0014 / 0015 / 0017

## Live dry-run
- Script: `scripts/_live_dryrun_migrations_0014_0015_0017.mjs`
- Result: PASS (`tmp-mig-0014-0015-0017-dryrun/report.json`)
- Temp branch deleted after verification
- Preview host untouched during dry-run

## Preview apply
- Script: `scripts/_apply_preview_0014_0015_0017_sql.mjs` (direct SQL, same order as dry-run)
- Host: `ep-polished-recipe-***`
- Applied: 0014 → 0015 → 0017
- Formulas after: 842 versions / 784 vigentes
- `0016` not needed for notifications (idempotency = deterministic UUID PK)
- Extra schema for Creamy `user_id` is **0017** (0016 already = Genus Auth)

## Why 0017
0015 keyed personal memories by `user_email`. Enterprise session ownership needs stable `user_id`.
Notification idempotency does **not** need a new column.

## Smoke
- `scripts/_smoke_0014_0015_notif.mjs` — PASS (13/13), TEST_*=0 after cleanup
