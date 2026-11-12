# ByteBack: three implemented maturity improvements

Framework: general tech-maturity principles for scalability, observability, and recoverability. Class slides were not provided; these are not claimed to be the instructor's exact stage labels.

1. **Scalable catalog:** Added indexed SQL filtering and six-item catalog pages so larger inventories do not require downloading or rendering every device at once.
2. **Operational visibility:** Added live readiness checks, request IDs and a private health dashboard so the operator can detect database failures and trace API errors quickly.
3. **Recoverable data:** Added hourly SQLite snapshots with integrity checks and restore drills so donation, reservation and reward data can be recovered from a verified copy.

## What is implemented

- Catalog: SQL `LIMIT`/`OFFSET`, safe parameterized filters, supported sort orders, database indexes, bounded responses (6 default, 48 maximum), full-inventory filter facets, cancellation of superseded browser requests, and static-preview pagination.
- Monitoring: public `/api/health` returns HTTP 503 when the DB is unavailable; `/api/ops` requires authentication and live organizer access. The local demo allows signed-in fictional demo accounts to inspect operator features. Metrics are measured per process since startup. Request logs/IDs omit bodies, query strings, cookies, tokens and emails.
- Recovery: online snapshots run on startup and hourly while the app process runs, retain seven verified copies by default, and can be triggered from Operations. Every snapshot passes SQLite `quick_check`, is restored to a separate temporary DB, and has inventory/order/reward row counts compared. Snapshots are private files; there is no backup-download endpoint or live restore button.

## Review locally

1. Run `python3 server.py` and open `http://localhost:4173/app.html#catalog`.
2. Use Next / Previous; filters search the full available inventory.
3. Open `http://localhost:4173/app.html#operations`, sign in using a fictional address in the local demo, then view Service health and Backups & recovery.
4. Click **Create verified backup** to run another online snapshot and non-destructive restore drill.

## Recovery runbook

```sh
# Manual snapshot and restore drill:
python3 recovery.py backup --database .data/byteback.sqlite3 --directory .data/backups

# Restore a chosen verified snapshot to a NEW path (never overwrites a file):
python3 recovery.py restore --backup .data/backups/backup-YYYYMMDD-HHMMSS-ID.sqlite3 --output .data/restored.sqlite3
```

For an incident, stop app writes, choose the snapshot, inspect the restored copy and its row counts, then restart with `BYTEBACK_DB=.data/restored.sqlite3`. Review newer orders before replacing active data. Backups remain on the same host; encrypted off-host copies and a managed database are the next resilience steps. These changes mature the pilot; they do not constitute multi-host production deployment.

Settings in `.env.example`: `BYTEBACK_BACKUP_INTERVAL_SECONDS` (3600 default, 0 disables automatic snapshots), `BYTEBACK_BACKUP_KEEP` (7), optional `BYTEBACK_BACKUP_DIR`, and `BYTEBACK_LOG_REQUESTS` for sanitized structured logs.

## Verification completed

24 HTTP/SQLite tests and 5 catalog-logic tests pass. The new cases exercise a catalog with 200 additional records, page bounds/filter accuracy, a database-readiness failure, live-role restrictions, CSRF, private snapshot files, retention, invalid backups, non-overwriting restores, backup failure preservation and worker startup. Real-browser checks exercised page navigation, filter resets, operator sign-in, successful backup/restore verification and 320px/375px layouts with no script errors. Screenshots are in `output/maturity/screenshots/`; the submission sheet is `output/maturity/ByteBack-Tech-Maturity-Improvements.pdf`.
