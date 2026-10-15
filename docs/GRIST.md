# Grist sandbox setup and behavior

The connected calendar reads and writes `ALL_ATT` through a local Node server. An individual lesson uses its existing attendance row; group attendance links to a header in the same table. The browser never receives the API key. This is a service-account development connection; teacher sign-in and production permissions remain future work.

## Configure the connection

Use Node.js 20 or later from the repository root. No dependency installation is required. With no Grist configuration, `node scripts/serve.mjs` starts the fictional-data demo on port 4173.

The server and setup command accept either these process environment variables or one JSON line through `--grist-stdin`:

| Environment variable | JSON property | Value |
| --- | --- | --- |
| `GRIST_BASE_URL` | `baseUrl` | Grist origin, such as `https://YOUR-TEAM.getgrist.com` |
| `GRIST_DOC_ID` | `docId` | Document ID used by the Grist API |
| `GRIST_API_KEY` | `apiKey` | Service-account API key |

Supply all three. Partial configuration fails instead of silently opening demo mode. Configuration is read from process memory or stdin; the application does not load a `.env` file.

This PowerShell example prompts for the key without adding its value to shell history. Replace only the host and document placeholders:

```powershell
$gristSecret = Read-Host 'Grist API key' -AsSecureString
$gristCredential = [PSCredential]::new('calendar', $gristSecret)
$gristConfigJson = @{
  baseUrl = 'https://YOUR-TEAM.getgrist.com'
  docId = 'YOUR-DOCUMENT-ID'
  apiKey = $gristCredential.GetNetworkCredential().Password
} | ConvertTo-Json -Compress
```

Keep this variable in the same terminal for the following commands. It contains the connection in memory; do not print it, save it to a repository file or paste it into a URL.

## Current row model

The user's current classification is based on the existing reference cells:

| `student` | `group2` | Meaning | Calendar event |
| --- | --- | --- | --- |
| Empty | Any value | Group lesson header | Yes, with valid start/end |
| Referenced | Empty | Individual lesson and its attendance in one row | Yes, with valid start/end |
| Referenced | Referenced | Student attendance for a group lesson | No |

An empty student cell is deliberately treated as a group header under this rule, including existing rows. Missing or invalid times still prevent an event from rendering. There are no special indie/trial group-name exceptions in the current model.

`start`, `end` and `t` are the canonical schedule and teacher fields. The user explicitly authorizes updating those existing cells when editing a lesson. The calendar does not substitute new schedule override columns. Missing teachers appear as Unassigned; multiple references remain a combination.

`Calendar_Parent` links a group attendance row to a header within `ALL_ATT`. Individual attendance belongs to its own lesson row without creating a second row. Calendar event identities are `all-att:<row ID>`; `Calendar_UID` provides stable identities for creates and preparation retries.

## Set up schema and inspect the plan

```powershell
$gristConfigJson | node scripts/grist-setup.mjs --grist-stdin
```

This command **adds missing calendar columns**, validates existing definitions and previews aggregate preparation counts. It does not create headers or link attendance without `--prepare-all-att`. It never deletes existing columns or changes an incompatible existing definition; a mismatch stops setup.

The 13 added columns are:

| Column | Purpose |
| --- | --- |
| `Calendar_UID` | Stable create/preparation identity |
| `Calendar_Title` | Event title |
| `Calendar_Group_Label` | Freeform display label, separate from `group2` references |
| `Calendar_Room` | Room text |
| `Calendar_Participants` | Participant notes |
| `Calendar_Checklist` | Manual checklist text |
| `Calendar_Status` | Scheduling state: scheduled, cancelled or deleted |
| `Calendar_Notes` | Calendar-specific notes, separate from original `notes` |
| `Calendar_Mutation` | Last calendar edit/delete identifier |
| `Calendar_Origin` | Record origin |
| `Calendar_Parent` | Reference to another `ALL_ATT` row serving as a group header |
| `Calendar_Attendance` | Attendance state; pending bookings do not imply attendance |
| `Calendar_Revision` | Formula revision covering schedule, classification and calendar fields |

Exact types and the revision formula are defined in [`server/all-att-schema.mjs`](../server/all-att-schema.mjs). Setup validates the existing `start`/`end` timezone, reference types and editability; it retains existing trigger formulas. True formula columns cannot accept scheduling edits, so an incompatible source definition stops setup.

The former `Calendar_Lessons` table, `ALL_ATT.Calendar_Lesson` links and legacy revision fields remain intact. The active adapter does not use them. Removing or consolidating redundant fields is a later decision after practical validation.

## Prepare group headers and links explicitly

```powershell
$gristConfigJson | node scripts/grist-setup.mjs --grist-stdin --prepare-all-att
```

Preparation leaves individual lessons in their original rows. For attendance rows with both student and group references, it:

1. Groups by exact `start`, sorted `t` references and sorted `group2` references.
2. Reuses one unambiguous matching group header or creates a header with an empty student cell and a deterministic UID.
3. Requires a valid end time. New headers require the source rows' end times to agree; ambiguous headers or inconsistent timing are reported as conflicts rather than guessed.
4. Writes only the new `Calendar_Parent` link on original attendance rows, using conditional revision checks. Existing child schedule values and legacy links remain unchanged.

There is no automatic 60-minute fallback in this model: preparation uses the existing `start` and `end`. Already-linked rows retain their parent even when that header has moved. Missing times, conflicting headers, deleted targets or ambiguous identities are reported for review.

Headers are created in batches of 50 and links attempted in batches of 100. Readback verifies links and reports aggregate counts without printing school records. A partial result exits with a nonzero status. Unknown write outcomes stop the run; rerun the complete command to resume using stable identities rather than manually replaying individual requests. Preparation-created headers without a linked child remain hidden as pending preparation. Ordinary calendar-created group bookings can be visible without attendance.

To include standalone lessons created in the former calendar table, use:

```powershell
$gristConfigJson | node scripts/grist-setup.mjs --grist-stdin --prepare-all-att --include-legacy-calendar
```

The optional flag can also be used without `--prepare-all-att` to preview that additional work. It copies only old `Calendar_Lessons` rows whose `Origin` is `calendar`, with deterministic identities so reruns reuse them. They become group headers with no student attendance and retain their scheduling text and cancellation/deletion state. The old records remain untouched. Historical attendance imports are not replayed, and edits that exist only on those historical imported lesson rows are not copied over the current `ALL_ATT` schedule.

The former `--import-attendance` CLI option is rejected. The old importer and schema modules are retained as legacy code and tests, not as the active setup path. Historical live results are recorded in [STATE.md](STATE.md); they do not prove this transition or its current counts.

## Start the connected calendar

```powershell
$gristConfigJson | node scripts/serve.mjs --grist-stdin --port 4174
```

Open [http://127.0.0.1:4174](http://127.0.0.1:4174) in a dedicated browser tab. The interface identifies the Grist connection. Starting the server does not modify schema or prepare records. Stop it with Ctrl+C. Afterwards, clear the terminal variables:

```powershell
$gristSecret.Dispose()
Remove-Variable gristConfigJson, gristCredential, gristSecret
```

The server binds only to `127.0.0.1`. It validates local hosts, same-origin requests and a per-process write token. These controls support local use; they do not provide teacher authentication or per-user Grist permissions.

## What is saved

Create, edit, move, resize and cancel operations save narrow scheduling fields in `ALL_ATT`. A changed time or teacher writes the existing `start`, `end` or `t` cell. Other calendar edits use the new calendar columns. Original `datetime`, `per`, `notes`, financial inputs and formula definitions are not directly rewritten by this adapter. Existing formulas and triggers can recalculate after source cells change; this is particularly relevant for an individual lesson sharing its attendance row. The integration does not promise unchanged computed wages or timestamps.

Moving a group header preserves the child attendance rows' original scheduling cells and parent links. Cancellation retains the source row and its attendance. The API does not treat student group-attendance rows as editable calendar events.

The editor supports new group lessons with an optional existing group reference, or individual lessons with exactly one existing student and no group reference. On existing lessons, type, student references and group references are read-only and cannot be changed through the save API. The freeform Group label remains editable separately. Existing missing references are retained; new references must identify existing catalog records.

Open the lesson action menu by right-clicking an event, pressing Shift+F10 on a focused event, or using **⋯** in its editor. **Duplicate** opens an unsaved new lesson with copied scheduling details and manual checklist text, scheduled status and a fresh identity. Save creates the copy with `Calendar_Attendance=pending`; it does not copy recorded attendance, copy group children or reassign any source links.

**Delete** asks for confirmation and performs a soft deletion: its write changes only `Calendar_Status` to `deleted` and `Calendar_Mutation`. The lesson row and every attendance link remain intact, while the event disappears from calendar views. To restore it, change `Calendar_Status` to `scheduled` or `cancelled` in Grist, then refresh the calendar. There is no in-app undo.

Attendance is read-only. Blank `Calendar_Attendance` on existing student rows means recorded attendance, displayed as **Recorded in ALL_ATT** without inferring present or absent. Pending rows are not counted as attendance. Original notes and financial values never determine attendance state. Individual rows supply their own attendance; group attendance requires an explicit valid parent reference. Manual checklist text remains manual.

DateTime values are stored in Grist as epoch seconds with `Asia/Vladivostok` column types. The app exchanges UTC ISO instants with its server and converts school wall-clock input explicitly. SQL reference lists are decoded from their stored JSON representation only for known reference columns; ordinary text is left untouched.

## Conflicts, interrupted saves and scale

The server checks the editor's saved version and performs a conditional Grist upsert using the scalar `Calendar_Revision` formula. The formula includes `start`, `end`, `t`, `student`, `group2`, original notes and the calendar fields, so an external classification or reference change invalidates an open editor. This avoids using unhashable RefLists as direct Grist lookup predicates. Formula revisions are read, never assigned by save or preparation writes.

New lessons have a stable client-generated UUID. Each edit has a mutation ID. Mandatory readback and these identities help resolve a response lost after a successful write. A confirmed conflict keeps the draft and asks the user to reopen current data. An uncertain save keeps the draft and offers a safe retry. A failed refresh after a confirmed save does not turn that save into a reported failure.

Delete uses the same revision check. A failed or stale delete leaves the event visible. A retry with the same delete mutation ID can confirm a deletion that already succeeded; a different stale mutation is rejected. Saving an old editor draft cannot restore a deleted lesson.

The current adapter still loads the complete projected `ALL_ATT` history, together with names from `PERFORMANCE` and `FOLKS`; saves also perform full projected readback. Reducing row duplication does not establish large-document performance. Date-range loading, targeted readback and realistic isolated 50k/100k measurements remain future work.

Run `node scripts/check.mjs` for the automated checks. The new store has 20 focused tests for writes, identity, concurrency and recovery. Live sandbox results are in [STATE.md](STATE.md), and browser interaction evidence is maintained separately in [BROWSER_CHECKS.md](BROWSER_CHECKS.md). Mocked tests or previous adapter browser checks are not evidence of current live behavior.
