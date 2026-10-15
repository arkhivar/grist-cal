# Actual state

Updated: 2026-10-15 (Asia/Vladivostok).

## Foundation and interface

The local checkout was established from `arkhivar/grist-cal`, original main commit `78bb31d`. Work is on `codex/standalone-calendar-demo`. The design reference is `arkhivar/grist` at `9bda49cdcfd4a23ff2c5c120cf4378737ded9f2e`.

The standalone interface provides week/day/month/agenda views, date navigation, teacher visibility, search, a lesson editor, click/drag creation, moving/resizing, cancellation, duplication, soft deletion, manual checklist text and linked read-only attendance. Phone-width screens start in Day view with a sidebar drawer. All scheduling uses Asia/Vladivostok independently of the device timezone.

Teacher visibility now includes **Hide all / Show all** and a per-teacher **Display this only** menu. Menus appear on hover/focus and remain visible on small screens or touch devices. Visibility actions retain search, date and view without writing data; refresh preserves hidden/solo selections, including when new teachers arrive. Show all, Clear filters and Reset opt back into showing newly discovered teachers. Reload still starts with every teacher visible. Keyboard dismissal/focus restoration and viewport-clamped menu placement are implemented, but the new menu's browser verification is pending because browser security rejected access to the local preview on this run.

FullCalendar Standard 6.1.21, its Luxon plugin, Luxon 3.7.2 and IBM Plex fonts are vendored. Exact sources, licenses and hashes are included. No dependency installation or build step is needed.

## Data modes

The default mode remains an in-memory demo with invented records, delayed writes, failure simulation, version conflicts and a reset barrier. Reload and Reset restore the sample week.

A server-side Grist adapter now supports persistent lesson creation, editing, moving, resizing, cancellation and soft deletion. Credentials remain in the Node process. The browser receives a normalized scheduling snapshot and read-only attendance, not the key or unrelated financial columns. The server binds to loopback and checks local Host, Origin and request tokens.

Duplicate and Delete are available from an event's right-click/Shift+F10 menu and the editor's **⋯** menu. Duplicate opens an unsaved scheduled copy with copied details/checklist, a new identity and no attendance. Delete confirms first, then writes only `Calendar_Status=deleted` and `Calendar_Mutation`. The Grist row and attendance links remain, and all calendar views hide the event. Failed or stale deletes keep it visible. Recovery is available by changing the status in Grist; there is no in-app undo.

`ALL_ATT` is now the event and attendance source. Under the user's current rule, an empty `student` cell identifies a group header; a student with empty `group2` identifies one individual lesson and its attendance in the same row; a student with a group identifies attendance only. Group attendance links through `Calendar_Parent` to a header in the same table. The user deleted `Calendar_Lessons` and subsequently its obsolete ALL_ATT.Calendar_Lesson and Calendar_Source_Revision columns on 2026-10-15. API reads confirm their absence; none is used by the active adapter.

Calendar edits update the existing `start`, `end` and `t` cells as authorized. Other scheduling details use new calendar fields. Moving a group header does not rewrite its children's dates or teachers. Individual edits change their own attendance row, so existing formulas can recalculate. New bookings use `Calendar_Attendance=pending` and do not count as recorded attendance. Existing attendance is displayed neutrally without inferring presence from notes, counts or wages.

End-time inspection confirmed a stored DateTime with a guarded one-hour fallback trigger, not a fixed one-hour formula column. The editor now offers 40/60/80-minute presets and Custom, with Start edits preserving the current duration and manual End edits updating the duration display. A calculated Duration_Minutes column supplies minute lengths in Grist. Canonical start/end, the existing end trigger and save/revision fields remain unchanged.

The live editor offers group/individual type and student/group references for new lessons and duplicates. Existing type and student/group references are read-only; freeform group labels remain editable. Missing and multiple references remain explicit. Pending individual bookings can be found by student name.

Setup and group preparation are explicit commands. A normal server start performs neither. Setup adds missing schema and rejects incompatible existing definitions. Preparation uses deterministic header identities, conditional links and readback verification, and can resume after an interruption. Preparation-created headers remain hidden until at least one attendance row links to them. See [GRIST.md](GRIST.md) for configuration and the precise grouping rule.

## Live sandbox verification

### Current ALL_ATT model — 2026-10-15

- Added 13 calendar columns without deleting or changing any preexisting column definition, including the existing `end` trigger formula.
- Kept 2,260 individual lessons in their original rows. Added 553 missing group headers, reused one existing header, and linked all 948 group attendance rows through `Calendar_Parent`.
- Copied two standalone legacy calendar-created lessons into ALL_ATT, retaining their scheduling details. Empty reference lists were verified semantically because Grist returns empty lists as null. The entire former `Calendar_Lessons` table is unchanged.
- Repeated preparation completed with zero new headers, zero link writes and zero conflicts; the two copied legacy lessons were reused.
- Compared every original non-formula input column across all 3,215 original rows. All values remained unchanged except Grist's automatic `Last_updated_at` on the 948 linked rows. No original rows were removed.
- After temporary probes were removed, ALL_ATT contained 3,770 rows: 2,817 visible lessons and 3,208 linked student attendance rows, with no unlinked attendance. Five existing rows lack valid scheduling times and remain excluded from events.
- Live HTTP/API checks on four isolated temporary rows verified individual creation in one row, pending attendance, idempotent create retry, start-only editing without changing the existing end, direct `start`/`end`/`t` readback, group movement preserving child inputs, duplication without copied/reassigned attendance, cancellation, soft deletion, delete retry and HTTP 409 for stale edits and resurrection attempts.
- Delete readback changed only the two intended input fields, plus the automatic timestamp and new revision formula. All four probe rows were removed after checking their unique identities and origins; original input preservation and the old calendar table were checked again afterward.

The new editor controls and adapter have not had a fresh interactive browser check: browser access was blocked under the tool's URL policy. The API checks above establish live persistence, not rendered interaction. Full-history reads remain; no 50k/100k performance benchmark has been performed.

### UUID default and column decision log — 2026-10-15

The user consolidated their former UUID column into Calendar_UID. Inspection found a regular `UUID()` formula, which had replaced the deterministic preparation IDs. A read-only preparation preview would have copied two legacy lessons again; no duplicate copies were made.

With explicit user approval, Calendar_UID was converted to a Text data column with a new-record-only UUID default and no change dependencies. Conversion preserved all 3,770 values, then 553 group preparation keys and two legacy-copy keys were restored using conditional revision checks. The other 3,215 IDs stayed unchanged. Calendar_UID was the only changed column definition. All other existing input values remained unchanged except automatic Last_updated_at values on the 555 repaired rows; revision formulas recalculated as expected.

Two disposable live API probes verified generation of an omitted UUID, stability after ordinary edits, preservation of a calendar-supplied UUID and return of the same row on a repeated create. The initial interrupted probe create was checked by readback before proceeding; it had produced no record. Both probes were removed after identity checks. Read-only schema validation accepts the repaired definition; the final preparation preview proposes zero headers or links, reuses both legacy copies and reports zero conflicts. The snapshot retains 2,817 lessons and 3,208 attendance entries.

The local validator now narrowly accepts supported new-record-only Calendar_UID defaults, with tests rejecting regular formulas and unsafe trigger settings. [COLUMNS.md](../COLUMNS.md) records current column roles and this repair. DateRegistry was still a proposal at that point; its subsequent implementation is recorded below. There were no new browser interaction checks for the UUID change.

### Shared DateRegistry — 2026-10-15

Added eight fields to the user's empty DateRegistry and formula references in ALL_ATT and Transactions. Populated 3,653 unique calendar dates from 2020-01-01 through 2029-12-31. Existing A/B/C columns, all prior column definitions and all original input values remained unchanged. School-day policy, holidays and terms are initially unspecified; weekends are not assumed closed.

- Live formulas linked all 3,765 dated ALL_ATT rows and all 2,004 Transactions rows to their correct Asia/Vladivostok date. Five undated ALL_ATT rows remain unlinked. Registry date/short-weekday values match the existing helpers; transaction Date values were compared using their tagged representation.
- All 3,653 day/month parity values match arithmetic from the fixed January 2026 anchor. No registry formula errors or duplicate/invalid dates were found. Repeating population produced zero writes.
- One disposable group lesson and three temporary date rows verified automatic date linkage, a move across school midnight, preserved identity, unchanged lesson revision after metadata edits, and a successful save using the original version after that metadata edit. Explicit closed-day metadata did not block saving.
- Temporarily duplicating the probe date cleared its derived reference and metadata join without hiding the lesson. Removing the probe date also left the lesson visible. The temporary lesson and date rows were removed only after checking their identities against the baseline.
- Original input preservation was checked across all 3,770 ALL_ATT rows and 2,004 Transactions rows, with zero changes including automatic timestamps. All preexisting definitions in those tables and DateRegistry remained identical.
- The final snapshot retains 2,817 lessons and 3,208 attendance entries, with 3,653 available dates and zero unmatched lesson dates. Registry metadata is read once per snapshot, separate from save preflight/readback and lesson revisions.

Calendar UI support includes explicit closed-day shading/labels, holiday and term context, mini-calendar descriptions and editor date context. Metadata refresh preserves the current draft. Editing school metadata currently happens in Grist. The connected local server was started with the updated adapter; `/api/config` and `/api/snapshot` returned HTTP 200 in Grist mode, with the final counts above and no connection credentials in the snapshot. **Interactive browser verification remains pending** because local browser access was previously rejected under the tool's URL policy; no alternate route was attempted.

The cleanup plan identifies date, day and hasDate as three gross ALL_ATT candidates, offset by one new reference column. The existing date field still supplies a conditional rule and the Calendar_Parent display helper. No helper or formatting definition was changed or deleted. Full consumer review and practical validation come before cleanup. This registry adds useful shared metadata; no large-document speedup or 50k/100k benchmark is claimed.

### Duration presets and reporting — 2026-10-15

Added only the new Numeric formula Duration_Minutes to ALL_ATT. Live readback matched all 3,766 valid timestamp pairs and returned blank for five undated rows. Repeat setup added zero columns. One isolated temporary lesson verified successful 40-, 60-, 80- and custom 75-minute saves crossing school midnight, with matching formula values. A zero-length fixture interval returned blank. The probe was removed after checking its identity and origin. All 3,771 original rows remained; original input values, column definitions and active revisions were unchanged.

The UI selector changes unsaved timestamps and does not send an independent duration field. Existing, duplicate and selected-range minute lengths are retained. Custom focuses the end input; failed saves and refreshes preserve the controller/draft. New controller tests cover preset/custom transitions, invalid input, midnight/year/leap-day boundaries, device-timezone independence and failed-save recovery. Actual browser interaction/geometry remains unverified under the prior local URL-policy restriction; no alternate browser route was used.

### Historical separate-table adapter

After the user reported deleting Calendar_Lessons, a fresh read confirmed the table is absent and Calendar_Lesson is now an Int column retaining old row numbers. Calendar_Source_Revision remains its only detected formula consumer across the 18 remaining tables. Removal is recommended in that order: source revision first, old link second. All other current Calendar_* fields remain required or intentionally retained. The live snapshot succeeds with 2,817 lessons, 3,209 attendance entries and an available registry; ALL_ATT contains 3,771 rows and all active revisions are valid hashes. No live data/schema writes were performed for this check. Do not use the optional --include-legacy-calendar migration against the deleted table.

Retirement readiness was audited on 2026-10-15 after DateRegistry integration. The active adapter's snapshot/create/edit/delete also pass a regression with Calendar_Lessons, Calendar_Lesson and Calendar_Source_Revision absent. A read-only live audit found 2,733 legacy rows; both standalone copies match their ALL_ATT counterparts. All 2,731 imports resolve through retained links to current lessons, with 46 mapping to multiple targets. One marked import has differing old/current scheduling values; reconciliation or archival remains necessary before deletion. Document dependencies and removal order are recorded in [COLUMNS.md](../COLUMNS.md). No live data or schema changed in this audit. The checks below remain historical evidence, not approval to discard unresolved differences.

The following checks describe the former `Calendar_Lessons` adapter, not the current ALL_ATT behavior. The initial integration checks on 2026-10-13 established:

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

`node scripts/check.mjs` passes JavaScript syntax checks, all **19 vendored-file hashes** and **202 automated tests**. Coverage includes ALL_ATT classification, additive preparation/resume, schema preservation, safe UUID defaults, pending bookings, reference identity, narrow schedule writes, timezone conversion, scalar conditional writes, uncertain responses, draft preservation, deletion failures/retries and concurrency, local HTTP boundaries, operation without legacy schema and the retained legacy adapter. DateRegistry coverage includes bounded/idempotent population, lost responses, concurrent duplicates, preservation of manual metadata, timezone links, safe missing-data fallback and text-only accessible UI context. Duration coverage includes additive helper validation, exclusion from revisions/writes, preset/custom transitions, timezone boundaries and failed-save draft recovery.

The earlier demo passed interactive desktop and 390px phone-width checks for dragging, resizing, selection creation, failure recovery, teacher filters/search, navigation, cancellation, checklist round-trip, draft refresh, dirty-close confirmation and focus recovery. See the browser log for the individual runs. These checks are interactive, not an automated end-to-end suite. Physical touch devices, other browser engines and browser timezone emulation remain separate verification work.

GitHub Actions runs the repository checks on pushes and pull requests. Passing local checks does not establish a completed hosted CI run.

## Next

Review the single-table calendar in practical scheduling workflows and complete browser checks for the new editor controls. The user has removed the obsolete lesson table and its two ALL_ATT fields; further column cleanup requires a separate dependency review and decision. Date-range loading and realistic scale measurements remain pending. Recurrence, teacher authentication, production permission enforcement and deployment remain future work. Grist Cloud is still a development sandbox; production operations continue in SeaTable. Authentik, NetBird and Puppet remain candidates for the eventual self-hosted teacher pilot.
