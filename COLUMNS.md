# Column decisions

Updated: 2026-10-16 (Asia/Vladivostok).

This is the running decision log for the Grist data model. Record a column's purpose, owner, write rules, status and reason for keeping or changing it here as we discuss it. **Implemented** describes the current application, **accepted** describes an agreed contract, **legacy** means retained but unused by the active calendar, and **proposed** does not authorize a schema change. Keep verification evidence separate from design intentions.

## Accepted foundation

`ALL_ATT` holds both lessons and attendance. An empty `student` reference identifies a group header; a student with empty `group2` identifies an individual lesson in the same row; a student with nonempty `group2` identifies attendance only. Individual lessons do not require a second lesson row. Calendar events use stable `all-att:<row ID>` identities.

Existing column definitions and input values are protected unless the user explicitly authorizes a specific change. The user approved the editable-duration migration on 2026-10-16: lesson writes now target `start`, `Duration_Minutes` and `t`; `end` is derived. Adding calendar columns is authorized. Further cleanup requires dependency review and a decision; an unused calendar field may still serve another widget.

## Current columns

| Column | Purpose and write rules | Status / decision |
| --- | --- | --- |
| `start`, `end` | Start is stored DateTime; End is a read-only DateTime formula adding Duration_Minutes in UTC. Both display Asia/Vladivostok. The app exchanges UTC ISO instants and Grist stores epoch seconds. | Implemented and live-verified 2026-10-16. Calendar saves never write formula End. |
| `Duration_Minutes` | Stored editable Numeric input. No automatic Grist default; calendar creation supplies its chosen length. Positive fractional/custom lengths are preserved. | Authoritative schedule input included in projections, writes and revisions. Invalid/missing/nonpositive values produce blank End. |
| `t` | Canonical teacher reference list. Preserve missing/multiple references. Calendar edits may change the teacher. | Accepted. |
| `student`, `group2` | Classify rows and identify students/groups. Existing references are read-only in the editor; new individual lessons select exactly one student and no group. | Accepted. |
| `Calendar_Parent` | Ref:ALL_ATT from a group attendance row to its particular group lesson header. Individual attendance belongs to its own row. | Accepted; the day registry does not replace this lesson link. |
| `Calendar_Date` | Formula Ref:DateRegistry derived from this row's own `start` in Asia/Vladivostok. Empty if the timestamp or unique matching date is missing. | Implemented; Grist recalculates it, the calendar never writes it directly. |
| `Calendar_UID` | Stored creation/retry identity. The app supplies an ID before creating a row, so retrying a lost response finds that same row. Preparation also uses deterministic IDs. | Accepted shared identifier column; new rows entered directly in Grist may receive a UUID default. See the identity decision below. |
| `Calendar_Revision` | Formula fingerprint of protected scheduling, reference and calendar fields. Atomic saves compare it to detect concurrent changes, including direct Grist edits. | Implemented; retain this protection. A stable UUID cannot replace a revision. |
| `Calendar_Mutation` | Identifies a particular save/delete operation so its retry can recognize an already completed write. | Implemented; retain separately from permanent identity. |
| `Calendar_Source_Revision` | Former attendance-import concurrency helper. | Removed by the user on 2026-10-15; absence verified by API. |
| `Calendar_Lesson` | Former reference to Calendar_Lessons, briefly converted to Int when that table was deleted. | Removed by the user on 2026-10-15; absence verified by API. Calendar_Parent remains the active lesson link. |
| `Calendar_Status` | Scheduled, cancelled or deleted. Soft deletion preserves the row and attendance links. | Implemented; delete writes this and Calendar_Mutation only. |
| `Calendar_Attendance` | Separates bookings from recorded attendance. New bookings are pending; existing blank values are shown neutrally as recorded. | Implemented; attendance remains read-only in the calendar. |
| `Calendar_Origin` | Former provenance marker; the preparation safeguard now uses the exact existing Calendar_UID pattern. | Removed with user authorization and live-verified 2026-10-16. No replacement column. |
| `Calendar_Title`, `Calendar_Group_Label`, `Calendar_Room`, `Calendar_Participants`, `Calendar_Checklist`, `Calendar_Notes` | Calendar-specific display text, location, participant notes and manual checklist. The group label is separate from group references; calendar notes are separate from original attendance notes. | Implemented; discuss individual consolidation candidates before merging. |
| Original `notes`, financial inputs and formula definitions | Existing attendance and parallel salaries functionality. | Preserve; do not infer attendance from payments or notes. |

The user deleted `Calendar_Lessons` on 2026-10-15; a fresh API read confirms it is absent. The obsolete standalone `UUID` column was also removed by the user; the selected shared identifier column is `Calendar_UID`.

### Check after the user's table deletion — 2026-10-15

At the first check, both obsolete ALL_ATT columns remained. Calendar_Lesson had become Int with 3,211 nonempty old IDs; Calendar_Source_Revision still referred to `$Calendar_Lesson.id` and was the only formula mentioning either obsolete field across the remaining tables. Removal was recommended in that order: source revision, then old link. **The user subsequently removed both columns; a fresh API read confirms their absence.** No live columns were deleted or changed by the assistant during these checks.

At that historical check, the 13 base Calendar_* fields were still required; Calendar_Origin has a separate retirement decision below. Calendar_Date serves the shared date registry. Calendar_Parent continues to link attendance to current ALL_ATT lessons and must remain. That snapshot contained 2,817 lessons, 3,209 attendance entries and 3,771 ALL_ATT rows; all active revisions were valid hashes. These are observations from that check, not permanent counts.

The optional `--include-legacy-calendar` path still targets the deleted table and should no longer be used. Normal startup/default setup do not use it. The audit and proposed sequence below describe the state **before the user deleted the table**, including differences then identified; they do not assert that archival/reconciliation was completed.

## Editable duration — implemented 2026-10-16

The user approved stored `start` + editable `Duration_Minutes` → calculated `end`. Typing 80 in Grist moves End to Start + 80 minutes; changing Start preserves duration. The calendar retains its existing start/end editor and gesture contract: the adapter translates resizing or End edits into a duration write. Schedule writes include the mutation and use the existing conditional revision check. Duration now participates in revisions so direct Grist changes invalidate stale drafts. End readback checks the calculated result, including after lost responses.

The migration freezes the existing calculated durations before changing End, preserving every valid historical endpoint and blank undated row. It applies to attendance rows as well as lesson rows because Grist column definitions cover the entire table. Moving a group header still leaves child attendance schedules alone. The former end default/trigger is replaced; new calendar lessons still default to 60 minutes or the selected range, while new rows entered directly in Grist require a duration.

Live migration preserved all 3,769 original rows: 3,764 valid start/end intervals and five wholly undated rows. All original stored inputs and duration values remained identical; only the three authorized definitions (duration, end, revision) changed. A separate synthetic table verified freezing values, fractional minutes and historical DST. Disposable ALL_ATT tests verified calendar creation, direct duration edits, stale-save rejection, duration-preserving moves, fractional resizing, metadata edits, retry and deletion. All fixtures were removed and original inputs compared again. See [STATE.md](docs/STATE.md).

### Calendar_Origin retirement — implemented 2026-10-16

The live audit found 553 prepared-header markers and 3,216 blanks. Every marked row already has an exact `all-att-group:<64 lowercase hexadecimal characters>` UID; all 553 currently have attendance links. The model now uses that exact, case-sensitive pattern only for group headers to keep unlinked preparation rows hidden. Ordinary UUID, manual, legacy and malformed-prefix headers are not hidden by this safeguard. Existing preparation IDs remain unchanged.

The active projection, revision formula, schema validator and create/preparation writes no longer require Calendar_Origin. Normalized origin metadata, where retained, is derived from existing deterministic IDs; it is not another stored field. The legacy separate-table adapter's Origin column is unrelated and remains untouched in historical code. The retirement audit found only the current revision formula and six view-field entries depending on this column, with no matching sort/filter, section link, typed column dependency or ACL rule. Live removal verification is recorded in [STATE.md](docs/STATE.md).

The revision update and column removal were applied together with the local writer stopped. All 3,769 original rows retained every remaining field except the intentionally changed revision; unrelated definitions were identical. The six obsolete view-field entries were removed by Grist. The same 2,815 lessons and 3,209 attendance entries loaded afterward. Live create/edit/delete and exact-UID orphan hiding passed on one disposable row, which was removed. Setup added zero columns and did not recreate Origin.

### Historical duration helper — implemented 2026-10-15, superseded by the migration above

Live inspection confirms `end` is a **stored DateTime data column**, not a continuously calculated formula column. Its trigger is `value or ($start + datetime.timedelta(hours=1) if $start else None)` (with `import datetime`). It applies to new records and has start as a trigger dependency. The value guard preserves a nonempty end; the one-hour calculation fills a missing value. An explicit calendar save can store any valid supported end time. Grist's [trigger-formula documentation](https://support.getgrist.com/formulas/#trigger-formulas) explains this editable-default behavior.

Changing only start directly in Grist therefore leaves an existing end intact; it does not preserve duration automatically. Calendar dragging updates both endpoints to preserve duration; resizing changes end. The editor now preserves its current valid duration when Start changes, while manual End edits update the displayed duration. New lessons default to 60 minutes unless a selected range supplies an end.

The requested presets are **40, 60 and 80 minutes**, plus Custom displaying the current minute length. Choosing a preset computes End using UTC arithmetic and school-time conversion, including overnight lessons. Choosing Custom focuses End without altering either timestamp. Existing lessons, duplicates and selected ranges retain their current minute lengths; manual end changes and resized lessons are not rounded to a preset. Refresh and failed saves retain the unsaved duration/timestamp draft.

`ALL_ATT.Duration_Minutes` was added as a calculated Numeric column for viewing/filtering/reporting in Grist. It uses each row's own start/end, including attendance rows; moving a group header does not rewrite child duration values. The formula converts both timestamps to UTC before subtracting, preserves fractional minutes and returns blank for missing/invalid/nonpositive intervals. It is outside the 13 base fields, save projection and revision formula. Explicit schema setup adds/validates it; normal startup does not change schema.

Live verification matched all 3,766 valid source intervals and five undated blanks. One disposable lesson verified 40/60/80/custom-75-minute saves across school midnight and a blank for a zero-length interval; that fixture was removed. All original input values, existing column definitions and active revision values remained unchanged. Repeating schema setup added zero columns. Browser rendering/interaction verification remains pending under the existing local-preview access restriction.

An alternative start + editable duration model remains a separate possible migration: end would become derived, and the adapter, editor, preparation and validation would change together. This implementation provides a calculated Grist duration and editable calendar duration presets while retaining canonical start/end. The existing end definition was not changed.

## Calendar-created schema — retirement audit 2026-10-15

The user asked to prioritize retiring calendar-created schema. **Calendar_Lessons is not part of the intended final design.** The primary cleanup package is the whole old table plus ALL_ATT.Calendar_Lesson and ALL_ATT.Calendar_Source_Revision. The active calendar already operates without them; no replacement columns are needed. The user's date/day/hasDate helpers remain optional later consolidation work.

This was a read-only live audit plus a local regression test. No Grist columns, tables or records were changed or deleted. A retirement recommendation is separate from executing deletion.

### Application readiness

The active adapter's read/write projection and current revision formula omit both obsolete ALL_ATT fields. Default setup/preparation omit them and do not recreate the old table. A regression with the legacy table and both fields absent passes snapshot, create, schedule/teacher edit and soft deletion, preserving original lessons and attendance. Explicit guards reject attempted legacy access. This establishes adapter independence, not complete external-widget migration.

Explicit `--include-legacy-calendar` still reads the old table; retire this optional migration path when dropping it. The old importer/store/schema remain historical code. Do not delete `grist-model.mjs` blindly: the current model imports its `refs()` helper. Source cleanup must extract that shared helper or retain the library.

### Live audit findings before table deletion

- Calendar_Lessons contains **2,733 rows: 2,731 attendance imports and two standalone calendar lessons**. Each standalone lesson has exactly one deterministic ALL_ATT copy; all mapped scheduling/display fields match.
- Every imported lesson has retained source attendance links resolving to current lessons: 2,685 have one target; 46 have multiple targets under the changed grouping model. No linked source row lacks a resolvable target. A blind one-to-one migration would be incorrect.
- Imported rows have no nonempty Room, Participant_Notes, Checklist or Notes values, and all retain scheduled status. **One has an edit marker and Start/End values differing from its current ALL_ATT target.** The audit does not establish which version should prevail. Reconcile or archive the difference before deleting; never overwrite canonical times automatically.
- Reconstructing old grouping from current start/t and retained links matches 2,712 stored import keys; 19 do not match. Among matched keys, 554 generated Title/Group_Label values differ from current catalog-derived labels. These differences do not prove either version is authoritative. The former datetime/per columns are absent in the current document, so their original contents cannot be reconstructed from those columns. Preserve old values in a recovery copy before retirement.
- Across 19 tables and 192 column definitions, the only direct typed reference to the old table is Calendar_Lesson; the only matching formula is Calendar_Source_Revision reading that link. No table summary or explicit matching ACL rule was found.
- Each obsolete ALL_ATT field appears in six view-section field entries. The old table has three sections, including one user-page section; its Teacher display helper is internal. No matching saved-filter, sort or section-link dependency was found in inspected metadata. Views need cleanup; external widgets/scripts and dynamic references still require review.

### Proposed removal sequence before table deletion

1. Preserve a recoverable copy of the old table and attendance-link crosswalk outside the repository. No school-data backup was created or committed by this audit.
2. Resolve the marked scheduling difference; decide whether other differences need migration or archival. Recheck both standalone copies and external consumers while the old links remain available.
3. Retire the optional legacy migration path and remaining consumers; update affected views.
4. Remove **Calendar_Source_Revision**, then **Calendar_Lesson**, then **Calendar_Lessons**. The formula goes before its reference. Dropping the old table removes its own columns/helpers and records, not ALL_ATT attendance.
5. Verify live snapshot, create/edit/delete and attendance counts, then record the actual deletion here. Until authorized and executed, the live legacy schema remains present.

### Other calendar-created fields

| Fields | Decision |
| --- | --- |
| Calendar_UID, Calendar_Revision, Calendar_Mutation | Keep: creation/retry identity, concurrent-edit protection and operation retry identity serve separate purposes. |
| Calendar_Parent, Calendar_Status, Calendar_Attendance | Keep: specific lesson links, cancellation/deletion state and pending-versus-recorded attendance. |
| Calendar_Origin | Superseded decision: retirement authorized 2026-10-16, using existing deterministic UIDs for the preparation safeguard. |
| Calendar_Title, Calendar_Group_Label, Calendar_Room, Calendar_Participants, Calendar_Checklist, Calendar_Notes | Future consolidation candidates, not direct deletions. Choose authoritative replacements, preserve content, and adapt the projection, editor/save mapping, setup validator and revision formula together. Freeform group labels differ from references; calendar notes are not automatically attendance notes. |
| Calendar_Date | Keep for the shared date registry/reporting contract. It is derived and excluded from scheduling writes/revisions. |

This audit originally required all 13 base Calendar_* fields. Retiring Calendar_Origin reduces the active contract to 12. Blank cells alone do not make other columns safe to drop; deliberate consolidation requires equivalent behavior and dependency checks.

## Identity decision — 2026-10-15

Identity, revision and operation identity have different jobs. A lesson retains its identity when its time changes; its revision changes to protect open editors; its mutation identifies the particular write. These technical columns can be hidden from ordinary working views without removing their behavior.

The accepted Calendar_UID configuration is:

- Text **data column**, with stored values, not a continuously calculated formula column.
- Optional `UUID()` default for **new records only**, with no record-change dependencies. The guarded default `value or UUID()` is also supported by the local validator under the same trigger settings.
- Explicit IDs supplied by the calendar or preparation must remain intact. The default serves records created without a supplied ID.
- Existing `all-att-group:<hash>` and `legacy-calendar:<id>` values are valid preparation identities despite not having UUID formatting. Replacing them would change the preparation retry key.

The user moved `UUID()` into Calendar_UID. Read-only inspection found it had become a regular formula column, replacing the preparation identifiers. The preparation preview therefore proposed copying two already-preserved legacy lessons again. No such copies were created.

The user explicitly approved converting this column to stored values and restoring 555 unambiguously matched preparation IDs. Conversion preserved all 3,770 current IDs before the 553 group-header and two legacy-copy IDs were restored with conditional revision checks. This approval is specific to Calendar_UID; it does not relax preservation rules for other columns.

The schema validator now accepts the narrow safe default configuration while still rejecting a regular UUID formula, change-trigger settings and unreviewed formulas. It never silently rewrites an existing column definition. Live probes verified generated defaults, preservation of supplied IDs and safe create retry. Both temporary probes were removed; a preparation preview reports zero new rows/links and no conflicts. All unrelated input cells were unchanged except Grist's automatic timestamp on the 555 repaired rows. Full verification is recorded in [STATE.md](docs/STATE.md).

Grist recommends generating UUIDs in a new-record trigger to freeze the value; regular formulas can regenerate on recalculation. [UUID reference](https://support.getgrist.com/functions/#uuid). Trigger formulas distinguish new-record defaults from record-change behavior. [Trigger documentation](https://support.getgrist.com/formulas/#trigger-formulas).

## DateRegistry — implemented 2026-10-15

The user created the empty table and authorized its additive setup. It now contains **3,653 dates, 2020-01-01 through 2029-12-31 inclusive**, covering current attendance and transaction history with future scheduling space. The existing empty A/B/C columns remain unchanged. Populate or extend a range explicitly with `scripts/date-registry-setup.mjs`; normal server startup never changes schema or creates date rows. See [GRIST.md](docs/GRIST.md) for commands.

| Field | Owner and meaning |
| --- | --- |
| `DateRegistry.Date` | Stored Date; one row per calendar day. Population inserts only missing dates. Duplicate dates require review; neither formulas nor the app choose an arbitrary match. |
| `DateRegistry.Day` | Formula returning Mon/Tue/Wed/Thu/Fri/Sat/Sun, matching the existing short weekday helpers. |
| `DateRegistry.Day_Parity` | Formula counting days from 2026-01-01, modulo two; the anchor has value 0. |
| `DateRegistry.Month_Parity` | Formula counting months from January 2026, modulo two; the anchor month has value 0. |
| `DateRegistry.Is_Weekend` | Formula identifying Saturday/Sunday. This fact never determines school closure. |
| `DateRegistry.School_Day` | Manual Choice: Unspecified, Teaching day, Closed. Blank also means unspecified. No school week or holiday policy was invented. |
| `DateRegistry.Holiday_Name` | Manual Text; optional holiday label. |
| `DateRegistry.Academic_Term` | Manual Text; optional term label. |
| `ALL_ATT.Calendar_Date` | Formula Ref:DateRegistry, derived from that row's own `start` in Asia/Vladivostok. |
| `Transactions.Calendar_Date` | Formula Ref:DateRegistry, derived from `datetime` in Asia/Vladivostok, matching the existing transaction date helper's source. |

DateTime formulas explicitly convert to the school timezone, then use an indexed exact-date lookup and accept only one match. Missing timestamps, absent registry dates and duplicate dates yield an empty reference. The formula does not create missing dates. A manually entered date outside the prepared range needs explicit registry extension; it does not prevent calendar scheduling.

### Calendar behavior and relationship rules

Calendar_Date identifies a day; Calendar_Parent identifies a particular lesson. Several lessons can share a day while retaining separate attendance lists. `start`/`end` remain canonical and preserve time-of-day. Moving a group header changes its own derived day, while its children retain their original timestamps, date links and parent links. A report needing the parent's current scheduled day must follow the parent separately. Individual lessons follow their own start edit.

The app reads the registry once per snapshot and joins metadata by the lesson's canonical school date. It does not require the derived reference in its save projection. Explicit closed dates receive subtle shading and text cues; holidays and terms appear in date context and the editor. Edit these manual fields in Grist, then use Refresh. Labels are informational: they do not block saves, cancel lessons or mark attendance. A start-day reference describes only the starting date; editor context also covers subsequent days of an overnight lesson, excluding an end exactly at midnight.

Missing, duplicate or unreadable registry metadata never hides a valid lesson. Snapshot metadata reports aggregate coverage/ambiguity; this is not yet a user-facing maintenance dashboard. Date metadata and Calendar_Date are excluded from lesson revisions, so changing a term label does not invalidate an open scheduling draft. Demo behavior is unchanged without registry metadata.

### Concrete ALL_ATT cleanup candidates — not deleted

| Existing field | Replacement after migration | Work required before deletion |
| --- | --- | --- |
| `date` | `$Calendar_Date.Date` | Existing conditional formatting uses `$date`, and the Calendar_Parent display helper reads `$Calendar_Parent.date`. Migrate these consumers, audit views/filters and other widgets, and check range coverage before removal. |
| `day` | `$Calendar_Date.Day` | Migrate column displays, exports, filters and any external consumers to the reference value; verify out-of-range handling. |
| `hasDate` | Inline `bool($start)` wherever the existence check is needed | Audit its consumers. Do not substitute `bool($Calendar_Date)`: an out-of-range timestamp has a date but no registry link. |

These are **three gross removal candidates**, with one added Calendar_Date column: two fewer ALL_ATT columns overall if all three are eventually retired. This delivery creates the replacement path and verifies values; it does not delete or redefine any existing helper. New Calendar_Date values match all 3,765 valid ALL_ATT source dates and their short weekdays. All 2,004 transaction dates/weekday values also match (Transactions.date uses Grist's tagged Date representation). Formula inspection found the two concrete ALL_ATT.date dependencies above; UI settings and external integrations still require a full cleanup audit. Transactions.date/day are separate future candidates under the same rules.

### Parity semantics and performance limits

The implemented parity is fixed **calendar-day/month alternation**, independent of row IDs, deletion, insertion order or operational table scans. It is not alternating occupied dates: Monday and Wednesday have the same parity even when Tuesday has no records. Existing conditional formatting was not migrated. School week A/B and time-dependent flags such as current month remain separate policy decisions.

Sharing day metadata makes holiday/term maintenance useful to the calendar and provides consolidation opportunities. No existing expensive parity formula was replaced or benchmarked, so this delivery does not establish a speedup. Each source row still has a reference formula; the registry adds 3,653 rows. The adapter still reads full projected attendance history. Date-range loading, targeted readback and realistic 50k/100k measurements remain pending.

Live checks verified formula execution, zero-write repeat population, date-link changes across school midnight, metadata changes without revision conflicts, and safe missing/duplicate-date fallback. Temporary probes were removed after identity checks. All original input values and column definitions in ALL_ATT, Transactions and the initially empty registry remain unchanged. See [STATE.md](docs/STATE.md) for verification evidence and the outstanding browser check.
