# Interactive browser checks

Verified on 2026-10-13 using the Codex in-app browser against the loopback server. Desktop widths of 1280 and 1440px and a 390 × 844 phone viewport were inspected. The synthetic week was 12–18 October 2026. For repeatable future review, open `http://127.0.0.1:4173/?date=2026-10-13`.

These are recorded interactive checks, not an automated browser test suite. Use `node scripts/check.mjs` for the automated domain, store, asset and server checks.

| Check | Observed result |
| --- | --- |
| Initial week | 18 lessons, four teachers, overlapping and cancelled lessons; attendance rows do not become events. |
| Teacher visibility | Hiding Anna changes 18 to 13; Show all restores 18. |
| Search | An unmatched query shows zero lessons and a clear-filter action; clearing restores the schedule. |
| Linked attendance | First Monday lesson has three students, with present/absent statuses and one pending student link. |
| Draft refresh | Edit notes, refresh inside the editor: notes remain and the retained-draft notice appears. |
| Invalid time | End before start is rejected, with the draft kept and saved lesson unchanged. |
| Failed form save | Arm Demo tools → Fail the next save, edit and save: error appears, draft stays; retry saves. |
| Dirty close | Cancel an edited draft: Keep editing preserves it; Discard changes closes without saving. |
| Drag move | Move first Monday lesson from 09:00–10:15 to Tuesday 10:00–11:15; reopen confirms times and all three attendance records. |
| Resize | Drag the moved lesson's bottom edge to 11:45; saved event shows 10:00–11:45. |
| Failed drag | Arm failure and move again: error appears and original Tuesday 10:00–11:45 is restored. |
| Range creation | Select Monday 12:15–13:30, enter title and save: one new event appears, count 19, and navigation continues to work. |
| Views | Week, Day, Month and Agenda render; Agenda shows 19 events after creation. |
| Navigation | Next day, Today and mini-calendar selection show the correct school date. |
| Keyboard editing | Enter on a focused event opens its editor. |
| Cancellation and checklist | Set status Cancelled and checklist 3/7; reopen confirms both and unchanged attendance. |
| Reset | Confirmation restores the initial 18-event week. |
| Phone layout | Default Day view, sidebar filters, scrollable editor and visible save/cancel controls at 390px; new lesson saves successfully. |
| Focus recovery | Closing a phone editor returns focus to the persistent sidebar button. Escape from the drawer also returns focus there. |

The range-selection check exposed a temporary-preview event without teacher metadata. The renderer now handles that preview, and the full select → save → change-view flow passed again. A separate focus review corrected restoration to hidden/inert sidebar controls. No additional console errors were observed in the subsequent checks.

The demo uses synthetic records and makes no Grist requests. The following integration checks separately establish live persistence.

## Live Grist sandbox

Verified on 2026-10-13 against the configured local server at `http://127.0.0.1:4174`, with desktop and 390 × 844 phone viewports. Only two isolated, newly created lessons were used for write checks; both were removed afterward after validating their identities and absence of attendance links. No real school records or screenshots are committed here.

| Check | Observed result |
| --- | --- |
| Live loading | Loading indicator resolves to Connected to Grist; demo reset/failure tools are hidden. |
| Imported grouping | One group event opens five separate attendance entries from ALL_ATT, with source row references and notes. |
| Attendance meaning | Entries say Recorded in ALL_ATT; no present/absent status is inferred from notes or money. |
| Edit persistence | Room and manual checklist changes survive reload and match direct Grist readback. |
| Concurrent edit | A second writer changes the test lesson after the editor opens; the older browser save is rejected, its draft remains, and the newer value is preserved. |
| New lesson | Create produces exactly one Calendar_Lessons row with a stable UUID and no attendance rows. |
| Pointer move | Actual drag moves the new lesson to the following day; Grist stores the matching UTC instant for 09:00 school time. |
| Pointer resize | Actual bottom-edge drag changes duration from 60 to 90 minutes; direct Grist readback confirms it. |
| Cancellation | Cancelled status persists through reload. |
| Phone layout | Day view opens by default; the editor scrolls and keeps Save/Cancel visible at 390px width. |
| Concurrent lesson layout | Real overlapping lessons exposed text showing through an adjacent card. Side-by-side placement and contained wrapping now keep their titles separate. |
| Final view | Go to latest lesson opens the imported week; the live browser reports no console warnings or errors. |
| Import and data integrity | 2,731 imported lessons link 3,206 attendance rows; five undated rows stay unlinked. Rerun plans no new lessons or links. All 3,211 original rows retain the ten checked existing input fields, including financial and attendance values. |

The automated suite additionally covers failed writes, unknown outcomes, idempotent retries, concurrent reference changes, interrupted imports, and preservation of attendance when scheduling changes.

Not established by these checks: physical touch/long-press behavior, Safari/Firefox compatibility, browser timezone emulation, recurring series, or teacher-specific access rules. The local development service account is not a production authorization model.
