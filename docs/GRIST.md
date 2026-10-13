# Grist sandbox setup and behavior

The connected calendar uses a local Node server and a configured Grist development document. The browser never receives the API key. This is a service-account development connection; teacher sign-in and production permissions are still future work.

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

## Set up schema and inspect the plan

```powershell
$gristConfigJson | node scripts/grist-setup.mjs --grist-stdin
```

This command **adds missing calendar schema**, checks existing definitions and prints aggregate import counts. It does not create lesson records or link attendance until the import flag is supplied. It never deletes existing columns or changes an incompatible existing definition; a mismatch stops setup.

The schema consists of:

- `Calendar_Lessons`: lesson title, start/end, teacher/group references, group label, room, participant notes, manual checklist, status and notes; stable identity, mutation and import fields; and the formula `Calendar_Revision`.
- `ALL_ATT.Calendar_Lesson`: a reference to `Calendar_Lessons`.
- `ALL_ATT.Calendar_Source_Revision`: a formula covering source time, teacher/group/student references and the lesson link.

Exact column types and revision formulas are defined in [`server/schema.mjs`](../server/schema.mjs). Existing date and financial columns are preserved. Grist's existing automatic update timestamps may run when attendance links are added.

## Import attendance explicitly

```powershell
$gristConfigJson | node scripts/grist-setup.mjs --grist-stdin --import-attendance
```

The confirmed grouping rule is:

1. Match the exact `ALL_ATT.datetime`, sorted `per` teacher references and sorted `group2` references.
2. For indie/trial groups, matched case-insensitively by `PERFORMANCE.A`, also match the `student` reference set. Missing or unknown groups also use the student set.
3. If such a row has no student reference, isolate it by its source row ID. Missing teacher references become Unassigned; multiple teachers remain a combination.
4. Skip already-linked and undated/invalid-date rows. Duplicate attendance records can link to the same lesson without becoming duplicate events.

Each imported lesson starts with a **60-minute duration**. Its UID is derived from the grouping key, so retrying the import reuses its identity. Existing imported lesson fields, including subsequent teacher edits, are not overwritten. Attendance remains in its original table; the import writes only its new lesson link.

The importer creates lessons in batches of 50 and attempts links in batches of 100. Link writes compare the original source revision, time and blank link, so an intervening source edit is not overwritten. It reads links back and reports linked, conflicted, missing and skipped counts without printing school records. A partial result exits with a nonzero status.

If a write outcome is unknown, the importer stops. Rerun the full command to resume using the stable identities; do not manually replay individual write requests. Duplicate lesson UIDs or invalid revision formulas stop the import for review. Imported lesson records without any linked attendance stay hidden from the calendar and are counted as pending imports, so interrupted imports do not leave extra scheduled events. Lessons created in the calendar can be visible without attendance.

The delivered sandbox run created 2,731 lessons and linked 3,206 of 3,211 attendance rows; 5 undated rows remained unlinked. A second run planned no new lessons or links. These are verification results for that document, not expected counts for another document.

## Start the connected calendar

```powershell
$gristConfigJson | node scripts/serve.mjs --grist-stdin --port 4174
```

Open [http://127.0.0.1:4174](http://127.0.0.1:4174) in a dedicated browser tab. The interface identifies the Grist connection. Starting the server does not modify schema or run an import. Stop it with Ctrl+C. Afterwards, clear the terminal variables:

```powershell
$gristSecret.Dispose()
Remove-Variable gristConfigJson, gristCredential, gristSecret
```

The server binds only to `127.0.0.1`. It validates local hosts, same-origin requests and a per-process write token. These controls support local use; they do not provide teacher authentication or per-user Grist permissions.

## What is saved

Create, edit, move, resize and cancel operations save narrow scheduling fields in `Calendar_Lessons`. Cancellation changes a status and retains the record and its attendance. Imported source times in `ALL_ATT.datetime` and existing financial inputs are not synchronized or rewritten when a calendar lesson moves.

Open the lesson action menu by right-clicking an event, pressing Shift+F10 on a focused event, or using **⋯** in its editor. **Duplicate** opens an unsaved new lesson with copied scheduling details and manual checklist text, `scheduled` status, a fresh identity and no attendance. Only Save creates the new record; the original lesson and its attendance stay unchanged.

**Delete** asks for confirmation and performs a soft deletion: its write changes only `Status` to `deleted` and `Mutation_ID`. The lesson row, other values and every `ALL_ATT.Calendar_Lesson` link remain intact, while the event disappears from all calendar views. Deleted rows are counted separately from visible lessons, invalid lessons and pending imports. To restore one, change its Grist `Status` to `scheduled` or `cancelled`, then refresh the calendar. There is no in-app undo.

The editor's Group input changes the freeform `Group_Label` only. It preserves an imported lesson's original `Group` references. New lessons do not select a group reference yet.

Attendance is read-only and labelled **Recorded in ALL_ATT**. Each source row/student pair is shown, including a placeholder for a missing student link. Neither notes, counts nor wages are interpreted as attendance status. Manual checklist text remains manual.

DateTime values are stored in Grist as epoch seconds with `Asia/Vladivostok` column types. The app exchanges UTC ISO instants with its server and converts school wall-clock input explicitly. SQL reference lists are decoded from their stored JSON representation only for the known reference columns; ordinary text is left untouched.

## Conflicts and interrupted saves

The server checks the editor's saved version and performs a conditional Grist upsert using the scalar `Calendar_Revision` formula. The formula includes the reference-list identities, avoiding Grist's unhashable-list error for direct RefList predicates. Attendance import uses `Calendar_Source_Revision` in the same way. Formula values are read, never assigned by lesson/import writes.

New lessons have a stable client-generated UUID. Each edit has a mutation ID. Readback and those identities help resolve a response lost after a successful write. A confirmed version conflict keeps the draft and asks the user to reopen current data. An uncertain save keeps the draft and offers a safe retry; the editor is not locked. A failed refresh after a confirmed save does not turn that save into a reported failure.

Delete uses the same revision check. A failed or stale delete leaves the event visible. A retry with the same delete mutation ID can confirm a deletion that already succeeded; a different stale mutation is rejected. Saving an old editor draft cannot restore a deleted lesson.

Run `node scripts/check.mjs` for the automated checks. Live sandbox results are in [STATE.md](STATE.md), and browser interaction evidence is maintained separately in [BROWSER_CHECKS.md](BROWSER_CHECKS.md).
