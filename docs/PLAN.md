# Plan

## Accepted product decisions

1. Use a standalone browser tab with a full-window timetable, Google Calendar-style navigation and lesson interactions.
2. Draw visual styling from the pinned `arkhivar/grist` reference: IBM Plex fonts, warm neutral surfaces, restrained borders, blue accents and visible focus.
3. Display and edit all lesson times in Asia/Vladivostok, independently of the browser timezone.
4. Use `ALL_ATT` for both scheduling and attendance. An empty `student` reference is a group lesson header. A student with empty `group2` is an individual lesson and attendance in the same row. A student with nonempty `group2` is attendance only, linked to a group header through `Calendar_Parent`. Group headers and individual rows create events; group attendance rows do not.
5. Keep scheduling and attendance state separate even when they occupy one row. New bookings use `Calendar_Attendance=pending`; calendar duplication never copies recorded attendance or children. Manual checklist fractions remain text.
6. Add calendar columns without deleting existing columns or changing their definitions. The user explicitly authorizes edits to existing `start`, `end` and `t` cells when a lesson is edited. Preserve other original inputs and formula definitions, including those used by salaries; existing formulas and triggers may recalculate after authorized edits.
7. Prepare groups from exact `start`, sorted `t` and sorted `group2` references, reusing unambiguous headers where possible. Require valid end times and consistent ends before creating a header. Individual rows need no duplicate lesson row. The former indie/trial exceptions and 60-minute historical import default belong to the legacy adapter, not the current classification.
8. Grist Cloud is development-only; current production operations use SeaTable. Self-hosting is planned. Authentik is a candidate shared identity provider with NetBird, and Puppet is available for later Kubuntu rollout.
9. Commit and push meaningful verified updates. The delivered server is local development tooling; teacher deployment needs authentication and a verified permission model.

## Architecture

The presentation layer uses normalized lesson, teacher and attendance records through interchangeable adapters. The asynchronous memory adapter serves the default fictional-data demo. The browser Grist adapter calls a loopback Node server, which validates scheduling fields and uses the configured Grist document. API credentials remain server-side.

The active `all-att` model reads `ALL_ATT`, `PERFORMANCE` and `FOLKS`. `ALL_ATT.start`, `end` and `t` own scheduled times and teachers. New `Calendar_*` columns hold calendar-specific text, state, identity and concurrency information. `Calendar_Parent` is a reference to a group header in the same table. Individual attendance belongs to its own row. Grist DateTime values cross the server boundary as epoch seconds; the browser receives explicit UTC ISO instants and edits school wall-clock times.

Existing lesson type, student and group references are immutable through the calendar editor and API. New group headers may select an existing group; new individual lessons require exactly one existing student and no group. Moving a group header does not change child attendance dates. An individual edit changes its own schedule cells, so existing formulas may recalculate. The calendar does not write legacy `datetime`, `per`, notes, financial inputs or formula definitions directly.

The new `Calendar_Revision` formula covers scheduling, classification references and calendar fields. Conditional Grist writes compare this scalar revision within the engine. Stable create identifiers and saved mutation IDs support recovery after uncertain responses. Delete writes only `Calendar_Status=deleted` and `Calendar_Mutation`; rows and attendance remain, and stale editors cannot resurrect a deleted lesson.

Explicit setup adds schema and previews a plan by default. `--prepare-all-att` applies group headers and self-references. Optional `--include-legacy-calendar` copies standalone `Origin=calendar` lessons from the former table using deterministic identities. `Calendar_Lessons`, old `Calendar_Lesson` links and old revision fields remain intact and unused by the active adapter; historical imports are not replayed. See [GRIST.md](GRIST.md) for details.

The calendar uses pinned FullCalendar Standard v6 and its named-timezone plugin. Libraries and fonts are vendored for predictable local use. Full-history loading remains a known scaling limitation; no 50k/100k benchmark has established capacity.

## Milestones

1. **Local usability demo — delivered:** navigation, filtering, editing, moving/resizing, cancellation, linked fictional attendance, demo reset/failure controls and timezone/identity tests.
2. **Initial Grist mapping/import — historical milestone:** the earlier sandbox integration created `Calendar_Lessons` records and `ALL_ATT.Calendar_Lesson` links. That model is retained for compatibility and recovery; the active adapter now uses the single-table design above.
3. **Single-lesson persistence — implemented:** create/update/move/resize/cancel, unsaved duplication, confirmed soft deletion, validation, draft protection, conditional conflicts and safe retry. Teacher filtering includes Hide all / Show all and Display this only. The new ALL_ATT store has 20 focused automated tests. Live and browser verification for each revision is recorded in [STATE.md](STATE.md) and [BROWSER_CHECKS.md](BROWSER_CHECKS.md); prior browser results do not establish the new adapter's behavior.
4. **ALL_ATT transition — current milestone:** additive schema, direct individual lessons, group header preparation, canonical schedule edits and existing-student/group selection for new lessons. Validate the live transition and practical workflow before considering removal or consolidation of redundant legacy fields.
5. **Recurrence and scale — future:** weekly series, moved occurrences and exceptions; date-range loading, targeted readback and realistic isolated large-document measurements. Recurrence remains a feasibility gate before operational adoption.
6. **Teacher pilot — future:** per-user authentication, role/record permissions, phone/touch usability, deployment and operational transition.

Authentik login and authorization to Grist data are separate decisions. Verify the selected self-hosted edition and its authentication capabilities, then test each teacher's actual data permissions. The current development service account does not establish that permission model.

Google synchronization, Telegram, automatic checklist calculations and daily all-event counters are outside the delivered scope. Attendance editing and in-app recovery of deleted lessons remain future work.
