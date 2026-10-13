# Plan

## Accepted product decisions

1. Use a standalone browser tab with a full-window timetable, Google Calendar-style navigation and lesson interactions.
2. Draw visual styling from the pinned `arkhivar/grist` reference: IBM Plex fonts, warm neutral surfaces, restrained borders, blue accents and visible focus.
3. Display and edit all lesson times in Asia/Vladivostok, independently of the browser timezone.
4. One `Calendar_Lessons` record is one event. Student attendance stays in `ALL_ATT` and links through `Calendar_Lesson`; missing student references never create extra events.
5. Keep manual checklist fractions as text. Scheduling, attendance, lesson-level pay and student totals remain separate facts.
6. Permit additive schema changes without deleting existing columns. Preserve original attendance dates and financial inputs, including data used by the parallel salaries project.
7. Import existing attendance by exact start time, sorted teacher references and sorted group references. For indie/trial and missing or unknown groups, include student references; incomplete student rows in those cases stay isolated by source row ID. Set the initial lesson duration to 60 minutes.
8. Grist Cloud is development-only; current production operations use SeaTable. Self-hosting is planned. Authentik is a candidate shared identity provider with NetBird, and Puppet is available for later Kubuntu rollout.
9. Commit and push meaningful verified updates. The delivered server is local development tooling; teacher deployment needs authentication and a verified permission model.

## Architecture

The presentation layer uses normalized lesson, teacher and attendance records through interchangeable adapters. The asynchronous memory adapter serves the default fictional-data demo. The browser Grist adapter calls a loopback Node server, which validates scheduling fields and uses the configured Grist document. API credentials remain server-side.

`Calendar_Lessons` stores scheduling data and import identity. Original `ALL_ATT` rows retain their values and gain an explicit lesson reference. The UI reads attendance without changing or interpreting its status. Grist DateTime values cross the server boundary as epoch seconds; the browser receives explicit UTC ISO instants and edits school wall-clock times.

Formula revision columns cover the scheduling values and attendance source fields. Conditional Grist writes compare these scalar revisions within the engine, including changes to reference lists. Stable create identifiers and saved mutation IDs support recovery after uncertain responses. Setup/import run only when explicitly invoked. See [GRIST.md](GRIST.md) for the API and schema details.

The calendar uses pinned FullCalendar Standard v6 and its named-timezone plugin. Libraries and fonts are vendored for predictable local use.

## Milestones

1. **Local usability demo — delivered:** navigation, filtering, editing, moving/resizing, cancellation, linked fictional attendance, demo reset/failure controls and timezone/identity tests.
2. **Grist mapping/import — delivered in the sandbox:** explicit lesson records, preserved multi-teacher references, deterministic grouping, additive attendance links, safe resume and verification of original input preservation.
3. **Single-lesson persistence — delivered in the sandbox:** create/update/move/resize/cancel, field validation, draft protection, conditional conflict detection and safe retry for uncertain saves. Backend and live browser checks are recorded in [STATE.md](STATE.md) and [BROWSER_CHECKS.md](BROWSER_CHECKS.md). Deletion is not implemented. Group editing currently changes the freeform label; reference selection remains future work.
4. **Recurrence feasibility — next:** weekly series, moved occurrences, cancellation, and this-and-following edits while preserving exceptions and attendance history.
5. **Teacher pilot — future:** per-user authentication, role/record permissions, phone/touch usability, deployment and operational transition.

Authentik login and authorization to Grist data are separate decisions. Verify the selected self-hosted edition and its authentication capabilities, then test each teacher's actual data permissions. The current development service account does not establish that permission model.

Recurrence remains a feasibility gate before operational adoption. Google synchronization, Telegram, automatic checklist calculations and daily all-event counters are outside the delivered scope.
