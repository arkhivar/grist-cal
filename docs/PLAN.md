# Plan

## Accepted product decisions

- Display hours: the school opens 08:00–22:00 Asia/Vladivostok. Day/Week default to these hours with a remembered full-day toggle. This is a display preference, not a scheduling restriction or DateRegistry closure rule. Month/Agenda remain full-day; lessons outside the displayed hours stay saved and can be revealed.

1. Use a standalone browser tab with a full-window timetable, Google Calendar-style navigation and lesson interactions.
2. Draw visual styling from the pinned `arkhivar/grist` reference: IBM Plex fonts, warm neutral surfaces, restrained borders, blue accents and visible focus.
3. Display and edit all lesson times in Asia/Vladivostok, independently of the browser timezone.
4. Use `ALL_ATT` for both scheduling and attendance. An empty `student` reference is a group lesson header. A student with empty `group2` is an individual lesson and attendance in the same row. A student with nonempty `group2` is attendance only, linked to a group header through `Calendar_Parent`. Group headers and individual rows create events; group attendance rows do not.
5. Keep scheduling and attendance state separate even when they occupy one row. New bookings use `Calendar_Attendance=pending`; calendar duplication never copies recorded attendance or children. Manual checklist fractions remain text.
6. Add calendar columns without changing existing definitions unless specifically authorized. The approved schedule is stored `start` + editable `Duration_Minutes` → formula `end`; calendar writes update start/duration/t and never formula end. Preserve other original inputs and definitions, including those used by salaries. Explicitly approved migrations and cleanup are recorded in [COLUMNS.md](../COLUMNS.md).
7. Prepare groups from exact `start`, sorted `t` and sorted `group2` references, reusing unambiguous headers where possible. Require valid end times and consistent ends before creating a header. Individual rows need no duplicate lesson row. The former indie/trial exceptions and 60-minute historical import default belong to the legacy adapter, not the current classification.
8. Grist Cloud is development-only; current production operations use SeaTable. Prepare self-hosted staging now using a sandbox copy, and prove backup/restore before moving real operations. Authentik is the leading IdP candidate; NetBird and Kubuntu integration follow separately through Puppet.
9. Commit and push meaningful verified updates. The delivered server is local development tooling; teacher deployment needs authentication and a verified permission model.
10. Infrastructure/rollout and calendar UX proceed in parallel. Coordinate decisions here and observed results in [STATE.md](STATE.md); record authentication progress in [IDPS_AND_AUTH.md](../IDPS_AND_AUTH.md) and schema decisions in [COLUMNS.md](../COLUMNS.md). Puppet configuration and deployment automation belong in the separate Puppet repository.
11. The existing PERFORMANCE team roster supplies staff initials and standardized school email addresses. Mail hosting provides delivery; IdP enrollment, permissions and account lifecycle remain separate work. Do not publish individual roster entries in this repository.

## Architecture

The presentation layer uses normalized lesson, teacher and attendance records through interchangeable adapters. The asynchronous memory adapter serves the default fictional-data demo. The browser Grist adapter calls a loopback Node server, which validates scheduling fields and uses the configured Grist document. API credentials remain server-side.

The active `all-att` model reads `ALL_ATT`, `PERFORMANCE` and `FOLKS`. `ALL_ATT.start` and Duration_Minutes own the schedule, end is derived, and t supplies teachers. Calendar_* columns hold calendar-specific text, state, identity and concurrency information. Calendar_Parent references a group header in the same table. Individual attendance belongs to its own row. The DateRegistry table supplies shared date metadata; ALL_ATT.DateRegistry is its derived reference, renamed from Calendar_Date. Grist DateTime values cross the server boundary as epoch seconds; the browser receives explicit UTC ISO instants and edits school wall-clock times.

Existing lesson type, student and group references are immutable through the calendar editor and API. New group headers may select an existing group; new individual lessons require exactly one existing student and no group. Moving a group header does not change child attendance dates. An individual edit changes its own schedule cells, so existing formulas may recalculate. The calendar does not write legacy `datetime`, `per`, notes, financial inputs or formula definitions directly.

The new `Calendar_Revision` formula covers scheduling, classification references and calendar fields. Conditional Grist writes compare this scalar revision within the engine. Stable create identifiers and saved mutation IDs support recovery after uncertain responses. Delete writes only `Calendar_Status=deleted` and `Calendar_Mutation`; rows and attendance remain, and stale editors cannot resurrect a deleted lesson.

Explicit setup adds missing schema, validates definitions and previews a plan by default; it never performs schema migrations automatically. `--prepare-all-att` applies group headers and self-references. Calendar_Lessons, Calendar_Lesson, Calendar_Source_Revision and Calendar_Origin have been removed from the sandbox. Exact preparation UIDs preserve the orphan-header safeguard. Optional `--include-legacy-calendar` is historical code for documents that still contain the former table and must not be used on this sandbox. Historical imports are not replayed. See [GRIST.md](GRIST.md).

The calendar uses pinned FullCalendar Standard v6 and its named-timezone plugin. Libraries and fonts are vendored for predictable local use. Full-history loading remains a known scaling limitation; no 50k/100k benchmark has established capacity.

## Milestones

1. **Local usability demo — delivered:** navigation, filtering, editing, moving/resizing, cancellation, linked fictional attendance, demo reset/failure controls and timezone/identity tests.
2. **Initial Grist mapping/import — historical milestone:** the earlier sandbox integration created Calendar_Lessons records and ALL_ATT.Calendar_Lesson links. The active adapter uses the single-table design above; the obsolete live schema was removed.
3. **Single-lesson persistence — implemented:** create/update/move/resize/cancel, unsaved duplication, confirmed soft deletion, validation, draft protection, conditional conflicts and safe retry. Teacher filtering includes Hide all / Show all and Display this only. Duration presets are 40/60/80, with editable minutes in Grist and derived End. Live and browser verification for each revision is recorded in [STATE.md](STATE.md) and [BROWSER_CHECKS.md](BROWSER_CHECKS.md); prior browser results do not establish the new adapter's behavior.
4. **Local workflow polish — parallel UX track:** the ALL_ATT transition and explicitly authorized cleanup are implemented. Next proposals are remembered teacher visibility/view settings, faster searchable student/group selection, and nonblocking teacher-overlap warnings. Complete browser interaction checks while exercising real scheduling workflows. The latest date-helper dependency audit is in COLUMNS.md; further schema/UI consolidation remains a separate decision.
5. **Recurrence and scale — future:** weekly series, moved occurrences and exceptions; date-range loading, targeted readback and realistic isolated large-document measurements. Recurrence remains a feasibility gate before operational adoption.
6. **School rollout — active infrastructure track:** establish self-hosted staging and prove full-instance restore first. Then combine the tracks for a small teacher pilot after sign-in and enforced permissions pass. Observe a teacher working through a typical week and fix the demonstrated friction before expansion. SeaTable remains production throughout these gates.

Authentik login and authorization to Grist data are separate decisions. Verify the selected self-hosted edition and its authentication capabilities, then test each teacher's actual data permissions. The current development service account does not establish that permission model.

## Infrastructure milestone: staging with a proven restore

Status: preparation and read-only discovery; no staging host has been deployed or restored by this track. The user identified `arkhivar/puppet` as the private fleet-wide infrastructure repository. Target host/access and backup destination still need to be established. DNS names, image version/digest, edition, initial administrator login and recovery objectives must be recorded when the host is selected.

### Proposed initial topology

Use one isolated Linux VM/host with a pinned Grist container, private persistent storage, an HTTPS/WebSocket proxy and verified formula sandboxing. Limit initial access to administrators, preferably through the existing NetBird mesh. Start with local SQLite home storage and internal attachments unless the chosen infrastructure requires another layout. These are implementation recommendations, not yet deployed choices. Grist documents the home database separately from document storage in its [self-hosting guide](https://support.getgrist.com/self-managed/).

Keep the existing calendar service on loopback for administrator testing. Do not expose its shared development credential to teachers through a reverse proxy. Set up the selected Grist administrator authentication before importing the sandbox. The concrete Puppet manifests, secret references, backup jobs and restore commands belong in the Puppet repository.

Repository discovery: arkhivar/puppet is the production Puppet tree with a profile module, per-node Hiera/eyaml and NetBird-only management. The user confirmed Grist, IdP and backup setup are new work. Add a dedicated opt-in staging profile; do not attach it to the workstation group or global baseline. Preserve the existing SSH policy and keep secrets in its established external/encrypted mechanism. A target node and backup destination are still required before preparing its concrete catalog.

### Execution sequence

1. **Inventory and bootstrap:** inspect the target and Puppet conventions; record OS/resources, storage paths, network/TLS boundaries, pinned versions and secret storage. Establish administrator access and reject anonymous access. Verify persistence across a restart before importing data.
2. **Capture and import the sandbox:** export a complete `.grist` copy to protected storage outside the checkout. Record a timestamp/hash and derive the private comparison baseline from that exported snapshot, since other tracks can continue changing the live sandbox. Include external attachments separately if present and reconcile their inventory to the snapshot. Establish outbound isolation before import, then review copied webhooks/automations/custom integrations before permitting effects. Keep source access read-only during capture; do not run preparation or historical imports on the copy.
3. **Validate the copy:** compare all stored input values, table/column definitions, row IDs, Calendar_UID preparation keys, Calendar_Parent links, schedule precision and DateRegistry coverage against the captured baseline. Review expected volatile formula changes separately. Recreate/review intended staging membership and test ACLs, including user-ID-dependent rules/formulas and user-attribute mappings: cloud identities must not be assumed to retain the same local IDs. `.grist` exports include document access rules but not sharing membership; external attachments require a separate archive. See [exports](https://support.getgrist.com/exports/) and [access rules](https://support.getgrist.com/access-rules/).
4. **Create a recoverable backup:** stop calendar writers and Grist cleanly, then back up the full persistent volume, deployment configuration and protected recovery secrets. Retain a verified encrypted copy off the host before restarting. The initial stopped-instance approach avoids ordinary copying of active SQLite databases; a later online strategy needs database-aware handling. See [SQLite backup guidance](https://www.sqlite.org/backup.html).
5. **Restore independently:** rebuild into an empty, separate volume/instance using the same pinned version and the off-host backup. Do not mount staging's live writable volume. Establish outbound notification/integration isolation before starting restored services. Recover administrator access and permissions, then repeat data and calendar checks. A document re-import alone does not satisfy this gate.
6. **Operationalize:** implement scheduled backups, retention, failure/staleness monitoring and a repeatable restore command in Puppet. Proposed staging targets are nightly backups plus a backup before upgrades, a maximum 24-hour data-loss window and recovery within two hours; confirm these against the available destination and measured drill. Record actual timings, not assumed success. Re-run a drill after changes to storage or authentication dependencies.

Backup scope must match the actual topology: all `.grist` documents and attachments, home database (SQLite or PostgreSQL), persisted configuration and recovery secrets. Include object storage/version history and any external databases when configured. Once an IdP is deployed, its database, configuration, keys and administrator recovery are part of the recovery plan too. Document session invalidation/re-login behavior after restoration.

### Evidence required to close the milestone

| Check | Required evidence |
| --- | --- |
| Reproducible host | Puppet commit, pinned image digest, sanitized storage/network inventory and successful restart |
| Off-host recovery | Backup ID, capture time, checksum, encrypted destination reference and successful extraction on fresh storage |
| Data integrity | SQLite integrity checks where applicable; matching baseline inputs, schema, row IDs, preparation UIDs, parent links and retrievable attachments |
| Working application | Restored Grist opens; a representative calendar week displays in Asia/Vladivostok; an isolated fixture survives create/edit/restart/readback and soft deletion |
| Access boundary | Administrator can recover access; anonymous access is denied; expected staging membership and ACL behavior survive |
| Operational result | Measured recovery duration/data-loss window, backup job and alert test, failed checks and remediation recorded in STATE.md |

Keep detailed manifests, backups and record-level comparisons in protected storage. Commit only sanitized results and configuration references. This milestone remains open until the independent restore passes.

## Teacher pilot and migration gates

Before inviting a teacher, implement and verify the identity/permission contract in [IDPS_AND_AUTH.md](../IDPS_AND_AUTH.md). Agree which lessons, student details and attendance each role may read and edit; test that policy through both the UI and direct APIs using distinct accounts. Preserve the current narrow scheduling writes and concurrency guarantees.

Observe one teacher using a representative week: sign in, find their timetable, inspect attendance, create a booking, move/resize it, duplicate, cancel/delete, and recover from a failed or stale save. Record task completion, hesitation, time and data mistakes without putting student details in the log. Route demonstrated interaction issues back to the UX track, then repeat the affected tasks. Phone/touch behavior and recurrence feasibility remain adoption checks.

Expansion requires a repeatable SeaTable migration rehearsal, reconciled records/references and daily workflows, permission tests, restore evidence and a documented cutover/rollback plan. The staging sandbox import is not a SeaTable migration test. Avoid informal dual-writing while SeaTable remains the production source.

Google synchronization, Telegram, automatic checklist calculations and daily all-event counters are outside the delivered scope. Attendance editing and in-app recovery of deleted lessons remain future work.
