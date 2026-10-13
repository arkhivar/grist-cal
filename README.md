# grist-cal

A standalone school calendar, backed by Grist in a later milestone. The calendar opens in its own browser tab and takes its layout and interaction cues from Google Calendar, with the visual language of [arkhivar/grist](https://github.com/arkhivar/grist).

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

This checks JavaScript syntax, bundled asset hashes and the domain, adapter and local-server test suites. See [current state](docs/STATE.md) for verification results, including browser interaction checks.

## Current milestone

Milestone 1 is a local, in-memory demo with fictional lessons and attendance records. Work is on `codex/standalone-calendar-demo`.

- Day, week, month and agenda views, a mini-calendar, teacher filters and lesson/group/student search.
- Create and edit lessons; drag to move them and resize to change their duration. The lesson editor also provides keyboard-accessible time fields and a Cancelled status.
- Read-only fictional attendance linked to each lesson. Moving or cancelling a lesson preserves those records; scheduling never marks a student present.
- **Reset demo** restores the sample schedule. Under **Demo tools**, **Fail the next save** tests a failed edit, move or resize; **Refresh data** preserves an open lesson draft. The editor also has a refresh control.

The school timezone is **Asia/Vladivostok**, regardless of the browser's timezone. One scheduled lesson creates one calendar event; each student's attendance remains a separate record linked to that lesson.

Changes last only in the current tab's memory and are lost when the page reloads. Real Grist access, recurrence, sign-in and deployment are later milestones.

## Project notes

- [Plan and accepted decisions](docs/PLAN.md)
- [First implementation task](docs/FIRST_TASK.md)
- [Actual state and verification](docs/STATE.md)
- [Reference sources](docs/SOURCES.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md) and [pinned asset manifest](vendor/manifest.json)
- [Contributor guidance](AGENTS.md)

School data and credentials belong outside this repository. All committed sample data is invented.
