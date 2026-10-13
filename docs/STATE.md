# Actual state

Updated: 2026-10-13 (Asia/Vladivostok).

## Foundation and interface

The local checkout was established from `arkhivar/grist-cal`, original main commit `78bb31d`. Work is on `codex/standalone-calendar-demo`. The design reference is `arkhivar/grist` at `9bda49cdcfd4a23ff2c5c120cf4378737ded9f2e`.

The standalone interface provides week/day/month/agenda views, date navigation, teacher visibility, search, a lesson editor, click/drag creation, moving/resizing, cancellation, manual checklist text and linked read-only attendance. Phone-width screens start in Day view with a sidebar drawer. All scheduling uses Asia/Vladivostok independently of the device timezone.

FullCalendar Standard 6.1.21, its Luxon plugin, Luxon 3.7.2 and IBM Plex fonts are vendored. Exact sources, licenses and hashes are included. No dependency installation or build step is needed.

## Data modes

The default mode remains an in-memory demo with invented records, delayed writes, failure simulation, version conflicts and a reset barrier. Reload and Reset restore the sample week.

A server-side Grist adapter now supports persistent lesson creation, editing, moving, resizing and cancellation. Credentials remain in the Node process. The browser receives a normalized scheduling snapshot and read-only attendance, not the key or unrelated financial columns. The server binds to loopback and checks local Host, Origin and request tokens.

`Calendar_Lessons` is the event source. `ALL_ATT.Calendar_Lesson` links attendance to its lesson. Multi-teacher references remain intact, incomplete teacher references display as Unassigned, and attendance rows with missing students remain attendance. Connected attendance displays a neutral Recorded status without inferring presence from notes, counts or wages.

Setup and import are explicit commands. A normal server start performs neither. Setup adds missing schema and rejects incompatible existing definitions. The importer uses deterministic lesson identities, conditional links and readback verification, and can resume after an interruption. Partially imported lessons remain hidden until at least one attendance row links to them. See [GRIST.md](GRIST.md) for configuration and the precise grouping rule.

## Live sandbox verification

- Imported **2,731 lessons** and linked **3,206 of 3,211 attendance rows**. The remaining **5 rows have no date** and remain unlinked. Both temporary verification lessons were removed after their identities and origin were checked.
- A rerun planned **0 new lessons and 0 new attendance links**.
- All ten original input fields checked across all 3,211 attendance rows were unchanged. Existing automatic `Last_updated_at` behavior may run when a link is added.
- Initial imported durations are 60 minutes. Moving or resizing an imported lesson updates its calendar times; it does not rewrite the original `ALL_ATT.datetime` or financial inputs.
- Real scalar revision comparison succeeded for a current lesson and returned no matched records for a stale revision. Grist rejected RefList-valued lookup predicates, so comparisons now use dedicated formula hashes instead.
- SQL reference-list values were observed as stored JSON strings and are explicitly decoded only for the known RefList columns.
- The final snapshot contains 2,731 lessons, no pending imports, no invalid lessons and no dangling attendance links. API snapshots contain no credentials.

Live browser checks confirmed creation and persistence after reload, room/checklist edits, a pointer drag to the next day, a pointer resize from 60 to 90 minutes, cancellation and stale-version rejection that preserves the draft. An imported group lesson displayed its five linked attendance rows. Dialog controls were checked at 1280px desktop and 390px phone widths. Individual runs are recorded in [BROWSER_CHECKS.md](BROWSER_CHECKS.md).

## Automated and browser checks

`node scripts/check.mjs` passes JavaScript syntax checks, all **19 vendored-file hashes** and **79 automated tests**, including 43 backend, model and import tests. Coverage includes timezone conversion, record identity, import grouping/resume, scalar conditional writes, changing source data, uncertain responses, draft preservation, local HTTP boundaries and protection against accidental field writes.

The earlier demo passed interactive desktop and 390px phone-width checks for dragging, resizing, selection creation, failure recovery, teacher filters/search, navigation, cancellation, checklist round-trip, draft refresh, dirty-close confirmation and focus recovery. See the browser log for the individual runs. These checks are interactive, not an automated end-to-end suite. Physical touch devices, other browser engines and browser timezone emulation remain separate verification work.

GitHub Actions runs the repository checks on pushes and pull requests. Passing local checks does not establish a completed hosted CI run.

## Next

Review the connected calendar against real scheduling workflows, particularly imported one-hour durations and group labels. Recurrence, teacher authentication, production permission enforcement and deployment remain future work. Grist Cloud is still a development sandbox; production operations continue in SeaTable. Authentik, NetBird and Puppet remain candidates for the eventual self-hosted teacher pilot.
