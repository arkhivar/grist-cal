# Actual state

Updated: 2026-10-16 (Asia/Vladivostok).

## Infrastructure and rollout track — 2026-10-16

The user opened a parallel infrastructure track. Its first milestone is self-hosted staging from a sandbox copy with a proven full-instance restore. Sign-in and enforced teacher permissions gate the subsequent pilot; SeaTable remains the production source until migration and everyday workflows are verified. The staging sequence and acceptance evidence are in [PLAN.md](PLAN.md), with authentication details in [IDPS_AND_AUTH.md](../IDPS_AND_AUTH.md). Puppet implementation belongs in the separate infrastructure repository.

Preparation completed: reviewed local server boundaries and current Grist/Authentik documentation; recorded the backup/restore drill and pilot gates. Read-only sandbox requests confirmed existing PERFORMANCE.name, label and email fields. The 17 exact team rows all have populated email values: 16 pass a basic school-address format check, one fails basic email syntax, and none of the team addresses duplicates another PERFORMANCE address after trimming/case normalization. This is a syntax/uniqueness check, not mailbox ownership or login verification. No roster values or schema were changed.

The current server still uses one service-account client and shared snapshot state; its SQL reads are unsuitable for the intended restricted teacher identities. No authentication implementation, account provisioning or ACL changes were made. Current documentation distinguishes activated Grist native OIDC/OAuth apps from the Community forwarded-header route; neither route has been selected or tested on a host.

Cloned arkhivar/puppet locally and reviewed its instructions and deployment conventions without modifying it. It is the production Puppet tree, with per-node profiles, Hiera/eyaml secrets and NetBird-only management. The user confirmed the Grist/authentication/backup setup is new work. Staging should use a dedicated opt-in profile; no production host was contacted or classified.

**Staging and restore are not yet executed.** The user identified `arkhivar/puppet` as the private fleet-wide infrastructure repository; target host/access and backup destination remain to be established. No document export, deployment, backup job, restore or production migration has been performed by this track. Mail at the school's standardized domain is user-reported operational via HostUp/cPanel; IdP enrollment and recovery delivery have not been tested here.

## Foundation and interface

The local checkout was established from `arkhivar/grist-cal`, original main commit `78bb31d`. Work is on `codex/standalone-calendar-demo`. The design reference is `arkhivar/grist` at `9bda49cdcfd4a23ff2c5c120cf4378737ded9f2e`.

The standalone interface provides week/day/month/agenda views, date navigation, teacher visibility, search, a lesson editor, click/drag creation, moving/resizing, cancellation, duplication, soft deletion, manual checklist text and linked read-only attendance. Phone-width screens start in Day view with a sidebar drawer. All scheduling uses Asia/Vladivostok independently of the device timezone.

Live lesson titles now show searchable teacher and student/group chips, in that order, with optional editable text before and after the pair. New and duplicate lessons infer their type from the selected student or group, replacing the separate live type, student, group-reference and teacher fields. The student/group chip is locked on saved lessons; teacher assignments can still change through the teacher chip. Names follow their references, including catalog renames. Added text survives refreshes, save retries and duplication. The existing Calendar_Title column stores the editable parts; no schema change or backfill was performed. Untouched older title values remain intact, and the demo keeps its original free-text title and teacher fields. See COLUMNS.md for the storage and compatibility contract.

The sidebar's **Business hours only** control limits Day/Week to the user-confirmed 08:00–22:00 school hours. It defaults on and stores only this display preference in browser local storage, with an in-memory fallback if storage is unavailable. Unchecking restores 00:00–24:00; Month/Agenda always use full-day bounds. Counts distinguish wholly hidden and partially clipped lessons, including overnight events, and offer Show full day without clearing search/teacher filters or changing dates. No records or schema are changed. Seven focused boundary/timezone tests pass; actual rendering and pointer/keyboard checks remain pending under the existing browser access restriction.

Teacher visibility now includes **Hide all / Show all** and a per-teacher **Display this only** menu. Menus appear on hover/focus and remain visible on small screens or touch devices. Visibility actions retain search, date and view without writing data; refresh preserves hidden/solo selections, including when new teachers arrive. Show all, Clear filters and Reset opt back into showing newly discovered teachers. Reload still starts with every teacher visible. Keyboard dismissal/focus restoration and viewport-clamped menu placement are implemented, but the new menu's browser verification is pending because browser security rejected access to the local preview on this run.

FullCalendar Standard 6.1.21, its Luxon plugin, Luxon 3.7.2 and IBM Plex fonts are vendored. Exact sources, licenses and hashes are included. No dependency installation or build step is needed.

## Data modes

The default mode remains an in-memory demo with invented records, delayed writes, failure simulation, version conflicts and a reset barrier. Reload and Reset restore the sample week.

A server-side Grist adapter now supports persistent lesson creation, editing, moving, resizing, cancellation and soft deletion. Credentials remain in the Node process. The browser receives a normalized scheduling snapshot and read-only attendance, not the key or unrelated financial columns. The server binds to loopback and checks local Host, Origin and request tokens.

Duplicate and Delete are available from an event's right-click/Shift+F10 menu and the editor's **⋯** menu. Duplicate opens an unsaved scheduled copy with copied details/checklist, a new identity and no attendance. Delete confirms first, then writes only `Calendar_Status=deleted` and `Calendar_Mutation`. The Grist row and attendance links remain, and all calendar views hide the event. Failed or stale deletes keep it visible. Recovery is available by changing the status in Grist; there is no in-app undo.

`ALL_ATT` is now the event and attendance source. Under the user's current rule, an empty `student` cell identifies a group header; a student with empty `group2` identifies one individual lesson and its attendance in the same row; a student with a group identifies attendance only. Group attendance links through `Calendar_Parent` to a header in the same table. The user deleted `Calendar_Lessons` and subsequently its obsolete ALL_ATT.Calendar_Lesson and Calendar_Source_Revision columns on 2026-10-15. API reads confirm their absence; none is used by the active adapter.

Calendar edits update `start`, `Duration_Minutes` and `t` as authorized; end is calculated. Other scheduling details use calendar fields. Moving a group header does not rewrite its children's dates or teachers. Individual edits change their own attendance row, so existing formulas can recalculate. New bookings use `Calendar_Attendance=pending` and do not count as recorded attendance. Existing attendance is displayed neutrally without inferring presence from notes, counts or wages.

The editor offers 40/60/80-minute presets and Custom, with Start edits preserving duration and manual End edits updating the duration display. The user approved stored editable Duration_Minutes and formula end on 2026-10-16. The adapter translates UI endpoints into stored start/duration and verifies the derived end; raw duration participates in concurrency protection. The original end trigger and calculated duration helper are historical behavior, superseded by this migration.

The live editor's combined student/group picker supplies references and infers group/individual type for new lessons and duplicates. Existing type and student/group references are read-only; freeform group labels remain editable. Missing and multiple references remain explicit. Pending individual bookings can be found by student name.

Setup and group preparation are explicit commands. A normal server start performs neither. Setup adds missing schema and rejects incompatible existing definitions. Preparation uses deterministic header identities, conditional links and readback verification, and can resume after an interruption. Preparation-created headers remain hidden until at least one attendance row links to them. See [GRIST.md](GRIST.md) for configuration and the precise grouping rule.

## Live sandbox verification

### Searchable title chips — 2026-10-16

The teacher chip now opens the eligible teacher catalog; an existing historical assignment can remain unchanged. The second chip searches students and groups in one list with explicit type labels. Student selection creates an individual draft with one student and no group; group selection creates a group header without students. Group not assigned remains available. Duplicate drafts retain their source identity until deliberately changed; saved identities stay locked. Teacher changes and subject choices preserve both editable title parts. Search text never becomes an unlinked name or a submitted form field.

The connected server continued serving port 4173. Configuration, snapshot and all updated picker assets returned HTTP 200. The live catalog contained 1,383 students, 13 groups and 17 eligible teachers. The new identity controller matched the displayed reference name on all 2,820 lessons; read-only selection checks produced the expected individual/group payloads. No live rows, columns or API contracts were changed. Isolated store tests verified both selection directions, fresh pending bookings, unchanged original attendance and stable retries; these are not live writes.

All 309 tests, syntax checks and 19 vendor hashes pass. Picker tests use a small DOM/event harness for keyboard selection, Escape/Tab, focus callbacks, search, stale choices and text-only rendering. Review caught and removed an eligibility preflight that would have blocked unchanged retries after a teacher left the team. The existing server remains responsible for eligibility and retry acknowledgment. Actual pointer/touch, native focus, screen-reader behavior and popup geometry remain unverified under the local browser access restriction. Small/narrow-window styling keeps the popup in the scrollable form; this is implemented behavior awaiting visual verification.

### Linked title capsules — 2026-10-16

Restarted the connected local server on port 4173 and verified HTTP 200 for configuration, snapshot and updated editor assets. The read-only snapshot contained 2,820 lessons: every automatic title began with the exact normalized teacher name and included a nonblank student/group name. All existing title overrides were blank at the time of this check. No live records, column definitions or attendance links were changed for this update. The development process uses IPv4-first DNS after upstream connection timeouts with the default order.

The complete check suite passes 288 tests, syntax checks and 19 vendor hashes. New controller/model/store checks cover editable text around fixed names, teacher/reference changes, legacy text preservation, titleless creation, duplicate and retry stability, decoded text limits and omitted-title updates. Review also corrected numeric ordering of multiple references in the editor and avoided validating untouched legacy title text as a new write. Save tests used isolated in-memory Grist fixtures; they do not establish live persistence of the new title format. Browser rendering and interaction checks remain pending under the existing local URL access restriction.

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

### Teacher initials and expired-session save recovery — 2026-10-16

The active catalog now reads PERFORMANCE.name/label; the former A/type fields are absent in the live schema. New lesson choices contain exactly the 17 team records and preserve their stored initials verbatim. Existing historical missing/multiple/non-team assignments remain available on their own lesson without becoming new choices. The API enforces eligibility for new or changed assignments and can confirm a completed creation retry after its teacher loses the team label. Group display names also use the current source fields. Demo behavior is preserved.

Reproduced the reported unreadable-save error with a stale tab token: the old server returned a plain-text 403 before invoking Grist, and the client tried to parse JSON. API boundary rejections now return structured JSON. Only an explicit pre-write SESSION_EXPIRED rejection triggers one token renewal and replay of the identical body/mutation. Unreadable responses remain uncertain and never trigger automatic replay. Uncertainty from an earlier attempt remains attached to that pending mutation through later failures until acknowledgment.

The local server was restarted on port 4174. The actual browser-store module, exercised over local HTTP without browser rendering, created a disposable live Grist lesson using an expired token: two requests carried the identical payload, only one lesson appeared, and the selected teacher, 60-minute duration and pending attendance were correct. Repeating the creation returned the same row. The disposable row was removed; an interrupted cleanup request was read back as unapplied before the verified retry. All 3,770 original rows and all ALL_ATT column definitions were identical afterward. No Grist schema change was needed. The complete suite passes 260 tests, syntax checks and 19 vendor hashes. Browser rendering/interaction verification remains pending under the existing access restriction.

### ALL_ATT date reference rename — 2026-10-16

With user authorization, renamed Calendar_Date to DateRegistry in place, including its visible label. The column's identity, type, lookup formula and display settings were preserved. Grist updated the existing weekday and date-display formulas to `$DateRegistry.Day` and `$DateRegistry.Date`. All 3,769 ALL_ATT rows retained identical values after accounting for the name; revisions, registry rows, view-field settings and the live calendar's lesson/attendance/date results were unchanged. Across 17 tables, only the requested identifier/label and two dependent formulas changed. Transactions.Calendar_Date retains its name.

The setup default and fixtures now use ALL_ATT.DateRegistry. Setup rejects recreating the former name or adding a duplicate alongside an old-only reference. Live schema verification through a GET-only wrapper required zero additions in both source tables. Syntax checks, all 19 vendor hashes and 225 automated tests pass. This rename has live API verification; no browser or gesture changes were made. The user's earlier helper deletions and outstanding Grist display/summary repairs are recorded separately in COLUMNS.md.

### Calendar_Origin retirement — 2026-10-16

The authorized cleanup removed Calendar_Origin after replacing its preparation safeguard with an exact case-sensitive deterministic UID check. The live dependency audit found the revision formula and six displayed-column entries, with no matching sorts, filters, section links, typed column dependencies or ACL rules. All 553 marked rows already had the exact preparation UID and attendance links. The active schema now has 12 base Calendar_* fields, plus duration and the date reference.

With the local writer stopped, the revision formula update and RemoveColumn action were applied together. Every remaining field on all 3,769 original rows stayed identical except Calendar_Revision; unrelated definitions stayed identical. Setup added zero columns. After restart, the same 2,815 lessons and 3,209 attendance entries loaded with unchanged display/attendance values. A disposable live lesson verified create, edit to 80 minutes, soft deletion and the safeguard: an exact preparation UID without children hid it; restoring its ordinary UUID showed it. One interrupted fixture update was read back as unapplied before retry. The probe was removed after identity checks and all original remaining fields compared again with zero differences. All six obsolete view entries disappeared. No existing preparation UID changed.

### Editable duration migration — 2026-10-16

With explicit user authorization, froze Duration_Minutes to stored Numeric, replaced end's guarded trigger with the UTC elapsed-minutes formula, and added raw duration to Calendar_Revision. The three changes were submitted together with the local writer stopped. All 3,769 rows retained their original input values, including all 3,764 valid endpoints, five empty intervals and every duration value. Unrelated column definitions stayed identical. Schema validation added zero columns; preparation preview proposed zero new headers or links and zero conflicts.

Before migration, a disposable synthetic table verified conversion, fractional minutes, a historical DST interval and invalid-duration blanking. An interrupted fixture request was resolved by readback showing no change before retry. No interrupted live migration occurred.

After migration, a disposable ALL_ATT lesson passed HTTP creation at 40 minutes, direct Grist duration=80 with calculated end, stale HTTP save rejection (409), start-only movement preserving 80, retry of the same move, fractional resizing to 45.5, metadata editing without schedule changes, soft deletion and deletion retry. Both the lesson and synthetic table were removed after identity checks. Comparing all original rows again found zero stored-input changes. These are HTTP/API observations, not pointer-drag or browser-rendering evidence.

### Historical duration presets and reporting — 2026-10-15

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

`node scripts/check.mjs` passes JavaScript syntax checks, all **19 vendored-file hashes** and **309 automated tests**. Coverage includes ALL_ATT classification, additive preparation/resume, schema preservation, safe UUID defaults, pending bookings, reference identity, narrow schedule writes, timezone conversion, scalar conditional writes, uncertain responses, draft preservation, deletion failures/retries and concurrency, local HTTP boundaries, operation without legacy schema and the retained legacy adapter. DateRegistry coverage includes bounded/idempotent population, lost responses, concurrent duplicates, preservation of manual metadata, timezone links, safe missing-data fallback and text-only accessible UI context. Duration coverage includes stored-input validation and revision inclusion, calculated-end readback, fractional precision, preset/custom transitions, timezone boundaries and failed-save draft recovery. Editor conversion retains seconds/milliseconds for fractional lessons while whole-minute values retain their compact display. Origin retirement tests guard absent-column reads/writes, setup non-recreation and exact preparation UID matching, including malformed IDs, ordinary unlinked headers and deletion ordering. Title tests cover names following their references without storing generated text, legacy compatibility, surrounding text, decoded length limits and retries across renames.

The earlier demo passed interactive desktop and 390px phone-width checks for dragging, resizing, selection creation, failure recovery, teacher filters/search, navigation, cancellation, checklist round-trip, draft refresh, dirty-close confirmation and focus recovery. See the browser log for the individual runs. These checks are interactive, not an automated end-to-end suite. Physical touch devices, other browser engines and browser timezone emulation remain separate verification work.

GitHub Actions runs the repository checks on pushes and pull requests. Passing local checks does not establish a completed hosted CI run.

## Next

The UX track continues practical scheduling and browser checks for the new editor controls. Further column cleanup requires a separate dependency review and decision; date-range loading, realistic scale measurements and recurrence remain pending. The infrastructure track inspects arkhivar/puppet, establishes the host/backup destination, deploys isolated staging and executes the independent restore drill in PLAN.md. Teacher authentication and permission enforcement are required before the observed-week pilot. Grist Cloud remains a development sandbox and SeaTable remains production.
