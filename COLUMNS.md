# Column decisions

Updated: 2026-10-15 (Asia/Vladivostok).

This is the running decision log for the Grist data model. Record a column's purpose, owner, write rules, status and reason for keeping or changing it here as we discuss it. **Implemented** describes the current application, **accepted** describes an agreed contract, **legacy** means retained but unused by the active calendar, and **proposed** does not authorize a schema change. Keep verification evidence separate from design intentions.

## Accepted foundation

`ALL_ATT` holds both lessons and attendance. An empty `student` reference identifies a group header; a student with empty `group2` identifies an individual lesson in the same row; a student with nonempty `group2` identifies attendance only. Individual lessons do not require a second lesson row. Calendar events use stable `all-att:<row ID>` identities.

Existing column definitions and input values are protected unless the user explicitly authorizes a specific change. Lesson edits may update `start`, `end` and `t`. Adding calendar columns is authorized. Cleanup of redundant legacy columns requires a later dependency review and decision; an unused calendar field may still serve another widget.

## Current columns

| Column | Purpose and write rules | Status / decision |
| --- | --- | --- |
| `start`, `end` | Canonical lesson times; DateTime in Asia/Vladivostok. The app exchanges UTC ISO instants and Grist stores epoch seconds. Calendar edits may update these cells. | Accepted; retain existing definitions, including the end trigger. |
| `t` | Canonical teacher reference list. Preserve missing/multiple references. Calendar edits may change the teacher. | Accepted. |
| `student`, `group2` | Classify rows and identify students/groups. Existing references are read-only in the editor; new individual lessons select exactly one student and no group. | Accepted. |
| `Calendar_Parent` | Ref:ALL_ATT from a group attendance row to its particular group lesson header. Individual attendance belongs to its own row. | Accepted; keep even if a date registry is added. |
| `Calendar_UID` | Stored creation/retry identity. The app supplies an ID before creating a row, so retrying a lost response finds that same row. Preparation also uses deterministic IDs. | Accepted shared identifier column; new rows entered directly in Grist may receive a UUID default. See the identity decision below. |
| `Calendar_Revision` | Formula fingerprint of protected scheduling, reference and calendar fields. Atomic saves compare it to detect concurrent changes, including direct Grist edits. | Implemented; retain this protection. A stable UUID cannot replace a revision. |
| `Calendar_Mutation` | Identifies a particular save/delete operation so its retry can recognize an already completed write. | Implemented; retain separately from permanent identity. |
| `Calendar_Source_Revision` | Concurrency helper used by the former attendance importer. | Legacy; candidate for later retirement after checking other consumers. |
| `Calendar_Lesson` | Former reference from attendance to Calendar_Lessons. | Legacy; retain unchanged for now. |
| `Calendar_Status` | Scheduled, cancelled or deleted. Soft deletion preserves the row and attendance links. | Implemented; delete writes this and Calendar_Mutation only. |
| `Calendar_Attendance` | Separates bookings from recorded attendance. New bookings are pending; existing blank values are shown neutrally as recorded. | Implemented; attendance remains read-only in the calendar. |
| `Calendar_Origin` | Identifies calendar-created rows, prepared group headers and copied legacy lessons. | Implemented; used in safe preparation/recovery. |
| `Calendar_Title`, `Calendar_Group_Label`, `Calendar_Room`, `Calendar_Participants`, `Calendar_Checklist`, `Calendar_Notes` | Calendar-specific display text, location, participant notes and manual checklist. The group label is separate from group references; calendar notes are separate from original attendance notes. | Implemented; discuss individual consolidation candidates before merging. |
| Original `notes`, financial inputs and formula definitions | Existing attendance and parallel salaries functionality. | Preserve; do not infer attendance from payments or notes. |

The former `Calendar_Lessons` table is retained and unused by the active adapter. The obsolete standalone `UUID` column was removed by the user on 2026-10-15; the selected shared column is `Calendar_UID`.

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

## DateRegistry — proposed, not implemented

A shared table with one row per school calendar date is a useful candidate for school-wide day metadata. It complements lesson/attendance relationships and does not restore the former separate lesson table.

| Proposed field | Meaning |
| --- | --- |
| `DateRegistry.Date` | Date-only key, exactly one row per day within a defined continuous range. Uniqueness must be checked; duplicates must not be resolved by arbitrarily choosing a row. |
| `DateRegistry.Day_Parity` | Calendar-day alternation derived from an agreed fixed date anchor, if this is the intended formatting rule. |
| `DateRegistry.Month_Parity` | Alternation derived from the calendar month/year and a fixed anchor. |
| `DateRegistry.Is_Weekend` | Day-of-week fact; not necessarily a school closure. |
| `DateRegistry.Holiday_Name`, `Is_School_Day`, `Academic_Term` | Shared school-specific metadata that can support calendar shading, labels and scheduling checks later. |
| `ALL_ATT.Calendar_Date` | Optional new Ref:DateRegistry, preferably derived from that row's own start time converted to Asia/Vladivostok. |
| `Transactions.Calendar_Date` | Optional reference derived from the agreed business/payment date. Its source column has not been selected or audited. |

Final table/column names, covered years, parity semantics and school-week rules are still open decisions. No DateRegistry table or date-reference columns have been created by this work.

### A day link and a lesson link answer different questions

Several lessons can occur on the same day. Calendar_Date would identify that day; Calendar_Parent identifies the specific lesson attended. Both links can coexist. For example, two lessons on October 15 can share a date row while retaining separate attendance lists and separate lesson headers.

Keep start/end canonical and preserve time-of-day. Derive a day using Asia/Vladivostok explicitly: 2026-10-14T23:30Z belongs to October 15 at school. Blank or invalid timestamps remain unlinked and need an explicit missing-date state. A start-day reference alone does not describe both days of an overnight lesson.

Moving a group header would update its own date link. Child attendance retains its original source date and Calendar_Parent link. A report that needs the parent's current scheduled day can derive it separately. An individual lesson's date follows its own authorized start edit. Prefer a derived reference that tracks timestamp changes over a manually maintained second source of truth. Prepopulate the agreed date range, detect missing dates and extend it explicitly; a lookup alone does not create absent date rows.

Grist supports reference-valued lookups and reading fields through a reference. [References and lookups](https://support.getgrist.com/references-lookups/). Exact formulas must be verified against the chosen source date types and timezone before implementation.

### Decide what parity means before migrating formatting

Calendar-day parity and alternating distinct dates that happen to contain records are different rules. Monday and Wednesday have the same calendar-day parity, but would alternate if they were the only occupied dates. Filtering records can also change which dates are adjacent in a view. A fixed date registry does not guarantee alternating colors for every filtered list of occupied dates.

For fixed calendar-day parity, a formula such as `($Date - datetime.date(2026, 1, 1)).days % 2` (with `import datetime`) uses an explicit anchor and does not depend on attendance rows, date-row IDs, insertion order or table scans. Month parity can similarly use the month distance from an agreed anchor. These cheap date calculations can also be done directly on source rows without any registry. If the goal is only fixed striping, a new table is optional.

School week A/B is another distinct policy: its start anchor, holiday handling and whether it pauses or resets must be agreed. Do not assume ISO week-number parity implements that policy. Current/past-month flags are time-dependent and need a refresh rule; they are not permanently precomputed facts.

### Performance expectations

Replacing repeated whole-table distinct-date scans with direct date arithmetic or references should reduce that particular source of work, but the exact existing parity formulas have not been audited or benchmarked. Centralizing shared holidays and term definitions is a stronger reason for this table than computing simple parity.

Five years adds roughly 1,826 date rows, plus links/formulas on operational rows. Total work still depends on operational row count, dependencies and changes. The registry does not fix the calendar adapter's current full-history reads, nor does it establish 50k/100k performance. Measure representative formula recalculation and calendar loading separately before claiming a speedup.
