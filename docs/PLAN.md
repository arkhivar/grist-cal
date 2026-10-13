# Plan

## Accepted product decisions

1. The main interface is a standalone browser tab with a full-window timetable. It has Google Calendar-style navigation, a mini-calendar, teacher visibility, click/drag creation, lesson editing, dragging and resizing.
2. The visual reference is `arkhivar/grist`, pinned in SOURCES.md: IBM Plex fonts, warm neutral surfaces, restrained borders, blue accents and visible focus.
3. The school timezone is Asia/Vladivostok. All browsers show the same school schedule.
4. One lesson is one event. Individual student attendance is stored independently and linked to a stable lesson identity. Empty student references alone do not define a lesson.
5. `ALL_ATT` is the existing all-attendance table. A read-only schema inspection confirmed DateTime:Asia/Vladivostok on `datetime`, references to FOLKS and PERFORMANCE, and links to Transactions. Exact table migration remains undecided.
6. Manual fraction/checklist text remains manual. Scheduling, attendance, lesson-level pay and student totals are distinct facts.
7. The user permits new Grist columns as needed and forbids deletion of existing columns. Shared sandbox work must account for the salaries project.
8. Grist Cloud is currently development-only; real operations are in SeaTable. Self-hosting is planned. Authentik is a candidate identity provider shared with NetBird, and Puppet is available for later Kubuntu rollout.
9. Work is committed and pushed after meaningful verified updates. The first milestone is local; a production deployment is not part of it.

## Architecture

The presentation layer operates on normalized lessons, teachers and student-attendance records through a replaceable data adapter. The first adapter is asynchronous and in-memory, with delayed writes, failure injection, version checks and reset. The calendar component is pinned FullCalendar Standard v6 with a named-timezone plugin; assets are vendored for predictable local runs.

A future server adapter will read/write Grist using a configured host, document and schema mapping. It must enforce the authenticated user's rights. Authentik login and authorization to Grist data are separate concerns; do not ship an administrative API key to browsers. For Community self-hosting, evaluate trusted forward authentication with Grist's access rules; verify the deployed edition and version before selecting the production integration.

## Milestones

1. **Local usability demo:** full-window weekly calendar; teacher filters; day/week/month navigation; compact lesson editor with linked fictional attendance; create/move/resize/cancel; explicit demo state; reset; simulated save failure; timezone and identity tests.
2. **Read-only Grist:** map a test document, explicit lesson identities and attendance links; confirm one event per lesson and the correct times.
3. **Single-lesson editing:** persist narrow scheduling fields; protect drafts and history; handle failed and concurrent writes; test actual access rules. Add columns only as justified by the agreed mapping.
4. **Recurrence feasibility:** weekly series, moved occurrence, cancellation, and this-and-following edits preserving exceptions and attendance history.
5. **Teacher pilot:** role/record permissions, phone/touch usability, representative volumes, deployment and operational transition.

Recurrence is an early feasibility gate before operational adoption. Google synchronization, Telegram, automatic checklist calculations and daily all-event counters are outside milestone 1.
