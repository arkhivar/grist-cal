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

Not established by these checks: physical touch/long-press behavior, Safari/Firefox compatibility, actual Grist persistence or access rules, browser timezone emulation, recurring series, or production-volume performance. The demo uses synthetic records and makes no Grist requests.
