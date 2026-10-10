# SEC-7: creation audit

Scope: public website bookings, staff bookings (phone/Zalo/walk-in), and staff account creation. This change is stacked on F-2 and is not authorization to merge or deploy production.

Each creation and its audit are written in one D1 batch. A failed audit rolls back the creation. The audit identifies the inserted entity using the connection's last_insert_rowid(), not a global maximum. Website actors are fixed as `website:anonymous`; staff actors come from authenticated sessions. Audit summaries contain source/status/room/date metadata or account role, without guest contact details, notes, target login, passwords, hashes, or challenge tokens.

Admin audit filters now include `booking_create` and `account_create` with Vietnamese labels. Existing authentication and permission checks remain in force. Telegram notification happens after the booking transaction succeeds.

Validation: 352/352 focused tests across 12 files on Linux/Node 22.20.0, including 14 creation-audit cases: all three endpoints, rollback on audit failure, concurrent entity association, duplicate account race, privacy, rejected requests, notification failure, and action filters. Static build and artifact boundary checks pass (135 files, 15 required assets). Staging validation and CI must be recorded separately before release approval. No migration required.

Transaction semantics: https://developers.cloudflare.com/d1/worker-api/d1-database/
