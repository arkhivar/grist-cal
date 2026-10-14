# Actual state

Updated: 2026-10-14 (Asia/Vladivostok).

## Foundation and interface

The local checkout was established from `arkhivar/grist-cal`, original main commit `78bb31d`. Work is on `codex/standalone-calendar-demo`. The design reference is `arkhivar/grist` at `9bda49cdcfd4a23ff2c5c120cf4378737ded9f2e`.

The standalone interface provides week/day/month/agenda views, date navigation, teacher visibility, search, a lesson editor, click/drag creation, moving/resizing, cancellation, duplication, soft deletion, manual checklist text and linked read-only attendance. Phone-width screens start in Day view with a sidebar drawer. All scheduling uses Asia/Vladivostok independently of the device timezone.

Teacher visibility now includes **Hide all / Show all** and a per-teacher **Display this only** menu. Menus appear on hover/focus and remain visible on small screens or touch devices. Visibility actions retain search, date and view without writing data; refresh preserves hidden/solo selections, including when new teachers arrive. Show all, Clear filters and Reset opt back into showing newly discovered teachers. Reload still starts with every teacher visible. Keyboard dismissal/focus restoration and viewport-clamped menu placement are implemented, but the new menu's browser verification is pending because browser security rejected access to the local preview on this run.

FullCalendar Standard 6.1.21, its Luxon plugin, Luxon 3.7.2 and IBM Plex fonts are vendored. Exact sources, licenses and hashes are included. No dependency installation or build step is needed.

## Data modes

The default mode remains an in-memory demo with invented records, delayed writes, failure simulation, version conflicts and a reset barrier. Reload and Reset restore the sample week.

A server-side Grist adapter now supports persistent lesson creation, editing, moving, resizing, cancellation and soft deletion. Credentials remain in the Node process. The browser receives a normalized scheduling snapshot and read-only attendance, not the key or unrelated financial columns. The server binds to loopback and checks local Host, Origin and request tokens.

Duplicate and Delete are available from an event's right-click/Shift+F10 menu and the editor's **⋯** menu. Duplicate opens an unsaved scheduled copy with copied details/checklist, a new identity and no attendance. Delete confirms first, then writes only `Status=deleted` and a mutation ID. The Grist row and attendance links remain, and all calendar views hide the event. Failed or stale deletes keep it visible. Recovery is available by changing the status in Grist; there is no in-app undo.

`Calendar_Lessons` is the event source. `ALL_ATT.Calendar_Lesson` links attendance to its lesson. Multi-teacher references remain intact, incomplete teacher references display as Unassigned, and attendance rows with missing students remain attendance. Connected attendance displays a neutral Recorded status without inferring presence from notes, counts or wages.

Setup and import are explicit commands. A normal server start performs neither. Setup adds missing schema and rejects incompatible existing definitions. The importer uses deterministic lesson identities, conditional links and readback verification, and can resume after an interruption. Partially imported lessons remain hidden until at least one attendance row links to them. See [GRIST.md](GRIST.md) for configuration and the precise grouping rule.

## Live sandbox verification

The initial integration checks on 2026-10-13 established:

- Imported **2,731 lessons** and linked **3,206 of 3,211 attendance rows**. The remaining **5 rows have no date** and remain unlinked. Both temporary verification lessons were removed after their identities and origin were checked.
- A rerun planned **0 new lessons and 0 new attendance links**.
- All ten original input fields checked across all 3,211 attendance rows were unchanged. Existing automatic `Last_updated_at` behavior may run when a link is added.
- Initial imported durations are 60 minutes. Moving or resizing an imported lesson updates its calendar times; it does not rewrite the original `ALL_ATT.datetime` or financial inputs.
- Real scalar revision comparison succeeded for a current lesson and returned no matched records for a stale revision. Grist rejected RefList-valued lookup predicates, so comparisons now use dedicated formula hashes instead.
- SQL reference-list values were observed as stored JSON strings and are explicitly decoded only for the known RefList columns.
- The completed integration snapshot contained 2,731 lessons, no pending imports, no invalid lessons and no dangling attendance links. API snapshots contained no credentials.

Live browser checks confirmed creation and persistence after reload, room/checklist edits, a pointer drag to the next day, a pointer resize from 60 to 90 minutes, cancellation and stale-version rejection that preserves the draft. An imported group lesson displayed its five linked attendance rows. Dialog controls were checked at 1280px desktop and 390px phone widths. Individual runs are recorded in [BROWSER_CHECKS.md](BROWSER_CHECKS.md).

On 2026-10-14, a disposable live API probe confirmed creation/readback, successful soft deletion, absence from the normalized snapshot, a successful retry of the same delete mutation, and rejection of a stale edit with HTTP 409. Direct readback confirmed the deleted row retained its identity and start/end values. Only that unlinked probe was removed afterward. All 3,211 existing attendance rows retained their checked input fields and links compared with the baseline before this check. The final 2,732 visible lessons matched the starting snapshot exactly, with 3,206 attendance links and no remaining probe records.

The new action menus were exercised in the demo browser, including keyboard operation, failure/retry and a 390px editor. Live browser clicks for Duplicate/Delete were not checked on this run because browser security blocked access to the live tab; the live API checks above are separate evidence.

## Automated and browser checks

`node scripts/check.mjs` passes JavaScript syntax checks, all **19 vendored-file hashes** and **99 automated tests**. Coverage includes timezone conversion, record identity, import grouping/resume, scalar conditional writes, changing source data, uncertain responses, draft preservation, soft-deletion failures/retries and concurrency, local HTTP boundaries and protection against accidental field writes.

The earlier demo passed interactive desktop and 390px phone-width checks for dragging, resizing, selection creation, failure recovery, teacher filters/search, navigation, cancellation, checklist round-trip, draft refresh, dirty-close confirmation and focus recovery. See the browser log for the individual runs. These checks are interactive, not an automated end-to-end suite. Physical touch devices, other browser engines and browser timezone emulation remain separate verification work.

GitHub Actions runs the repository checks on pushes and pull requests. Passing local checks does not establish a completed hosted CI run.

## Next

Review the connected calendar against real scheduling workflows, particularly imported one-hour durations and group labels. Recurrence, teacher authentication, production permission enforcement and deployment remain future work. Grist Cloud is still a development sandbox; production operations continue in SeaTable. Authentik, NetBird and Puppet remain candidates for the eventual self-hosted teacher pilot.
