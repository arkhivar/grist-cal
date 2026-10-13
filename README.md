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

Follow [Grist setup and import](docs/GRIST.md) to supply server-only credentials, add the calendar schema and explicitly import attendance. Normal server startup reads existing data; it never creates schema or imports attendance.

The setup command supports a preview of the import plan and a separate `--import-attendance` flag. It preserves existing columns, creates one record per lesson in `Calendar_Lessons`, and links the original `ALL_ATT` attendance rows. The import is safe to rerun after partial completion.

Without Grist configuration, the command above starts the demo. With configuration, it starts the connected calendar. The browser shows which mode is active. A connected server may use port 4174 alongside the demo on 4173.

## What works

- Day, week, month and agenda views, a mini-calendar, teacher filters and lesson/group/student search.
- Create and edit lessons; drag to move them and resize to change their duration. In connected mode these changes and cancellation persist in Grist. The editor also provides keyboard-accessible time fields.
- Right-click an event, press Shift+F10 on a focused event, or use the editor's **⋯** menu to **Duplicate** or **Delete**. Duplicate opens an unsaved copy with a fresh identity, copied details and checklist, scheduled status and no attendance. Delete asks for confirmation, then hides the lesson while preserving its Grist row and attendance links.
- Read-only attendance linked to each lesson. Connected records are labelled **Recorded in ALL_ATT**; the app does not infer presence or absence from notes or financial fields. Scheduling preserves attendance links and does not change original attendance dates or financial inputs.
- Manual checklist text, teacher combinations and Unassigned lessons. Conflicting and uncertain saves keep the draft; uncertain saves offer a safe retry.
- **Refresh data** preserves an open lesson draft. In demo mode, **Reset demo** restores the sample schedule and **Fail the next save** tests failure recovery.

The school timezone is **Asia/Vladivostok**, regardless of the browser's timezone. One scheduled lesson creates one calendar event; each student's attendance remains a separate record linked to that lesson.

Demo changes last only in the current tab's memory. Connected changes remain after reload. Deleted lessons can be restored by changing their Grist status to `scheduled` or `cancelled`; there is no in-app undo yet. Recurring series, teacher sign-in, production permissions and deployment remain future work; the current server is a local development connection using a service account.

## Project notes

- [Plan and accepted decisions](docs/PLAN.md)
- [First implementation task](docs/FIRST_TASK.md)
- [Actual state and verification](docs/STATE.md)
- [Grist configuration, import and data model](docs/GRIST.md)
- [Reference sources](docs/SOURCES.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md) and [pinned asset manifest](vendor/manifest.json)
- [Contributor guidance](AGENTS.md)

School data and credentials belong outside this repository. All committed sample data is invented.
