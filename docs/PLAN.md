# Plan

## Accepted product decisions

1. Use a standalone browser tab with a full-window timetable, Google Calendar-style navigation and lesson interactions.
2. Draw visual styling from the pinned `arkhivar/grist` reference: IBM Plex fonts, warm neutral surfaces, restrained borders, blue accents and visible focus.
3. Display and edit all lesson times in Asia/Vladivostok, independently of the browser timezone.
4. Use `ALL_ATT` for both scheduling and attendance. An empty `student` reference is a group lesson header. A student with empty `group2` is an individual lesson and attendance in the same row. A student with nonempty `group2` is attendance only, linked to a group header through `Calendar_Parent`. Group headers and individual rows create events; group attendance rows do not.
5. Keep scheduling and attendance state separate even when they occupy one row. New bookings use `Calendar_Attendance=pending`; calendar duplication never copies recorded attendance or children. Manual checklist fractions remain text.
6. Add calendar columns without changing existing definitions unless specifically authorized. The approved schedule is stored `start` + editable `Duration_Minutes` → formula `end`; calendar writes update start/duration/t and never formula end. Preserve other original inputs and definitions, including those used by salaries. Explicitly approved migrations and cleanup are recorded in [COLUMNS.md](../COLUMNS.md).
7. Prepare groups from exact `start`, sorted `t` and sorted `group2` references, reusing unambiguous headers where possible. Require valid end times and consistent ends before creating a header. Individual rows need no duplicate lesson row. The former indie/trial exceptions and 60-minute historical import default belong to the legacy adapter, not the current classification.
8. Grist Cloud is development-only; current production operations use SeaTable. Self-hosting is planned. Authentik is a candidate shared identity provider with NetBird, and Puppet is available for later Kubuntu rollout.
9. Commit and push meaningful verified updates. The delivered server is local development tooling; teacher deployment needs authentication and a verified permission model.

## Architecture

The presentation layer uses normalized lesson, teacher and attendance records through interchangeable adapters. The asynchronous memory adapter serves the default fictional-data demo. The browser Grist adapter calls a loopback Node server, which validates scheduling fields and uses the configured Grist document. API credentials remain server-side.

The active `all-att` model reads `ALL_ATT`, `PERFORMANCE` and `FOLKS`. `ALL_ATT.start` and Duration_Minutes own the schedule, end is derived, and t supplies teachers. Calendar_* columns hold calendar-specific text, state, identity and concurrency information. Calendar_Parent references a group header in the same table. Individual attendance belongs to its own row. DateRegistry supplies shared date metadata; Calendar_Date is its derived reference. Grist DateTime values cross the server boundary as epoch seconds; the browser receives explicit UTC ISO instants and edits school wall-clock times.

Existing lesson type, student and group references are immutable through the calendar editor and API. New group headers may select an existing group; new individual lessons require exactly one existing student and no group. Moving a group header does not change child attendance dates. An individual edit changes its own schedule cells, so existing formulas may recalculate. The calendar does not write legacy `datetime`, `per`, notes, financial inputs or formula definitions directly.

The new `Calendar_Revision` formula covers scheduling, classification references and calendar fields. Conditional Grist writes compare this scalar revision within the engine. Stable create identifiers and saved mutation IDs support recovery after uncertain responses. Delete writes only `Calendar_Status=deleted` and `Calendar_Mutation`; rows and attendance remain, and stale editors cannot resurrect a deleted lesson.

Explicit setup adds missing schema, validates definitions and previews a plan by default; it never performs schema migrations automatically. `--prepare-all-att` applies group headers and self-references. Calendar_Lessons, Calendar_Lesson, Calendar_Source_Revision and Calendar_Origin have been removed from the sandbox. Exact preparation UIDs preserve the orphan-header safeguard. Optional `--include-legacy-calendar` is historical code for documents that still contain the former table and must not be used on this sandbox. Historical imports are not replayed. See [GRIST.md](GRIST.md).

The calendar uses pinned FullCalendar Standard v6 and its named-timezone plugin. Libraries and fonts are vendored for predictable local use. Full-history loading remains a known scaling limitation; no 50k/100k benchmark has established capacity.

## Milestones

1. **Local usability demo — delivered:** navigation, filtering, editing, moving/resizing, cancellation, linked fictional attendance, demo reset/failure controls and timezone/identity tests.
2. **Initial Grist mapping/import — historical milestone:** the earlier sandbox integration created Calendar_Lessons records and ALL_ATT.Calendar_Lesson links. The active adapter uses the single-table design above; the obsolete live schema was removed.
3. **Single-lesson persistence — implemented:** create/update/move/resize/cancel, unsaved duplication, confirmed soft deletion, validation, draft protection, conditional conflicts and safe retry. Teacher filtering includes Hide all / Show all and Display this only. Duration presets are 40/60/80, with editable minutes in Grist and derived End. Live and browser verification for each revision is recorded in [STATE.md](STATE.md) and [BROWSER_CHECKS.md](BROWSER_CHECKS.md); prior browser results do not establish the new adapter's behavior.
4. **Local workflow polish — current direction:** the ALL_ATT transition and explicitly authorized cleanup are implemented. Next proposals are remembered teacher visibility/view settings, faster searchable student/group selection, and nonblocking teacher-overlap warnings. Complete browser interaction checks while exercising real scheduling workflows. The latest date-helper dependency audit is in COLUMNS.md; further schema/UI consolidation remains a separate decision.
5. **Recurrence and scale — future:** weekly series, moved occurrences and exceptions; date-range loading, targeted readback and realistic isolated large-document measurements. Recurrence remains a feasibility gate before operational adoption.
6. **Teacher pilot — future:** per-user authentication, role/record permissions, phone/touch usability, deployment and operational transition.

Authentik login and authorization to Grist data are separate decisions. Verify the selected self-hosted edition and its authentication capabilities, then test each teacher's actual data permissions. The current development service account does not establish that permission model.

Google synchronization, Telegram, automatic checklist calculations and daily all-event counters are outside the delivered scope. Attendance editing and in-app recovery of deleted lessons remain future work.
