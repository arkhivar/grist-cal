# grist-cal

A standalone school calendar, backed by Grist in a later milestone. The calendar opens in its own browser tab and takes its layout and interaction cues from Google Calendar, with the visual language of [arkhivar/grist](https://github.com/arkhivar/grist).

## Current milestone

Milestone 1 is a local demo with fictional lessons and attendance records. Work is on `codex/standalone-calendar-demo`. See [current state](docs/STATE.md) for what actually works and has been verified.

The school timezone is **Asia/Vladivostok**, regardless of the browser's timezone. One scheduled lesson creates one calendar event; each student's attendance remains a separate record linked to that lesson.

## Project notes

- [Plan and accepted decisions](docs/PLAN.md)
- [First implementation task](docs/FIRST_TASK.md)
- [Actual state and verification](docs/STATE.md)
- [Reference sources](docs/SOURCES.md)
- [Contributor guidance](AGENTS.md)

School data and credentials belong outside this repository. All committed sample data is invented.
