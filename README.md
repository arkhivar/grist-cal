# grist-cal

A standalone school calendar with Grist persistence and a fictional-data demo. It opens in its own browser tab and takes its layout and interaction cues from Google Calendar, with the visual language of [arkhivar/grist](https://github.com/arkhivar/grist).

## Run locally

Use **Node.js 20 or later**. All browser libraries and fonts are included; no `npm install` or build step is needed.

```sh
node scripts/serve.mjs
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173) in a dedicated browser tab. Stop the server with Ctrl+C. To use another port, run `node scripts/serve.mjs --port 4174`.

Run the automated checks from the repository root:

```sh
node scripts/check.mjs
```

This checks JavaScript syntax, bundled asset hashes, and the domain, adapter, import and local-server test suites. See [current state](docs/STATE.md) for verification results.

## Connect a Grist sandbox

Follow [Grist setup and preparation](docs/GRIST.md) to supply server-only credentials, add calendar columns to `ALL_ATT` and explicitly prepare group headers and links. Normal server startup reads existing data; it never creates schema or prepares records.

The setup command ensures the additive schema and previews the preparation plan by default. `--prepare-all-att` applies that plan; optional `--include-legacy-calendar` also preserves standalone lessons created in the former calendar table. Individual lessons use their existing `ALL_ATT` row. Group attendance references a header in the same table through `Calendar_Parent`. Existing columns and the old `Calendar_Lessons` table remain in place; preparation can resume after partial completion.

The separate [DateRegistry setup](docs/GRIST.md#prepare-the-shared-date-registry) adds shared day metadata and derived date references. Its preview command is `node scripts/date-registry-setup.mjs --grist-stdin --from 2020-01-01 --through 2029-12-31 --include-transactions`; supply the connection JSON through stdin as described in the setup guide. Add `--populate` to fill the requested range. That initial range contains 3,653 days. Existing helper columns and date policy values are preserved.

Without Grist configuration, `node scripts/serve.mjs` starts the demo. With configuration, it starts the connected calendar. The browser shows which mode is active. A connected server may use port 4174 alongside the demo on 4173.

## What works

- Day, week, month and agenda views, a mini-calendar, teacher filters and lesson/group/student search.
- **Hide all / Show all** control every teacher calendar at once. Each teacher's **⋮** menu offers **Display this only**; it appears on hover or keyboard focus and stays visible on small screens and touch devices. These visibility controls preserve the current search, date and view and do not write to Grist.
- Create and edit lessons; drag to move them and resize to change their duration. Connected edits write the authorized `ALL_ATT.start`, `Duration_Minutes` and `t` cells plus calendar fields; End is calculated. Create a group lesson or choose an existing student for an individual lesson. Existing lesson type and student/group references are read-only. The editor also provides keyboard-accessible time fields.
- Choose **40, 60 or 80 minutes** in the editor, or edit End for a custom length. Changing Start preserves the current duration. You can also type minutes directly into Grist's editable `Duration_Minutes` column; Grist calculates End from Start plus those minutes.
- Right-click an event, press Shift+F10 on a focused event, or use the editor's **⋯** menu to **Duplicate** or **Delete**. Duplicate opens an unsaved copy with a fresh identity, copied details and checklist, scheduled status and no attendance. Delete asks for confirmation, then hides the lesson while preserving its Grist row and attendance links.
- Read-only attendance linked to each lesson. Existing records without an explicit attendance state are labelled **Recorded in ALL_ATT**; the app does not infer presence or absence from notes or financial fields. New bookings have pending attendance. Moving a group header preserves its child attendance times; editing an individual changes that row's authorized schedule cells, which may recalculate existing formulas.
- Manual checklist text, teacher combinations and Unassigned lessons. Conflicting and uncertain saves keep the draft; uncertain saves offer a safe retry.
- DateRegistry metadata supplies weekday/parity information, holiday names and academic terms. Explicitly closed school days receive calendar cues and editor context; weekends and holiday names alone do not close a day. These labels do not block scheduling or mark attendance.
- **Refresh data** preserves an open lesson draft. In demo mode, **Reset demo** restores the sample schedule and **Fail the next save** tests failure recovery.

The school timezone is **Asia/Vladivostok**, regardless of the browser's timezone. In `ALL_ATT`, an empty student reference means a group lesson header; a student with empty `group2` means an individual lesson in the same row; a student with a group means attendance only. An individual lesson therefore needs one row, while a six-student group lesson needs one header and six attendance rows.

Demo changes last only in the current tab's memory. Connected changes remain after reload. Deleted lessons can be restored by changing `ALL_ATT.Calendar_Status` to `scheduled` or `cancelled`; there is no in-app undo yet. Recurring series, teacher sign-in, production permissions and deployment remain future work; the current server is a local development connection using a service account. It still loads full history plus one projected registry read per snapshot; large-document performance has not been established. See [current state](docs/STATE.md) for live and browser verification rather than assuming automated tests establish either.

## Project notes

- [Column decisions and proposed schema changes](COLUMNS.md)
- [Plan and accepted decisions](docs/PLAN.md)
- [First implementation task](docs/FIRST_TASK.md)
- [Actual state and verification](docs/STATE.md)
- [Grist configuration, preparation and data model](docs/GRIST.md)
- [Reference sources](docs/SOURCES.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md) and [pinned asset manifest](vendor/manifest.json)
- [Contributor guidance](AGENTS.md)

School data and credentials belong outside this repository. All committed sample data is invented.
