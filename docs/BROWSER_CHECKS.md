# Interactive browser checks

## Business hours — 2026-10-16

The Day/Week **Business hours only** control is implemented for 08:00–22:00 Asia/Vladivostok. All **267 automated tests**, JavaScript syntax checks and 19 vendor hashes pass. Seven new tests cover exact boundary instants, fractional overlap, overnight/multi-day lessons, date-period clipping, full-day counts, unchanged lesson identities and device-timezone independence.

Browser interaction is **pending** under the previously reported local-preview access restriction; no alternate browser route was used. Expected checks, not observed results:

- Reload defaults to 08:00–22:00 unless a prior full-day preference was saved. Toggle by pointer or keyboard; reload restores the choice. Storage denial still permits toggling within the tab.
- Day/Week trim the time axis; Month/Agenda retain early/late lessons. Switching back restores the selected hours without changing date or teacher/search filters.
- Lessons ending at 08:00 or starting at 22:00 are hidden in business-hours mode. Boundary-crossing lessons are partly visible, keep their real endpoints and count once. The notice offers Show full day.
- A period containing only matching off-hours lessons shows an explanatory empty state. Its Show full day action retains the date/search/teacher selection and restores all matches.
- At 390px, the sidebar checkbox and notice action remain usable. Check layout, scrolling, keyboard focus and dragging/resizing at the displayed boundaries in a real browser before claiming those interactions verified.

## Earlier checks

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

## Duplicate and Delete — 2026-10-14

These new interactions were checked in the synthetic demo using the in-app browser. Browser security blocked access to the live tab on this run, so these menu checks do not establish live browser interaction with Grist.

| Check | Observed result |
| --- | --- |
| Event menu | Right-click opens Duplicate/Delete. Shift+F10 opens the menu on a focused event; arrow keys and Enter select an action. |
| Menu dismissal | Escape dismisses the menu and restores focus. |
| Duplicate | Opens an unsaved copy with copied details/checklist, scheduled status and a fresh identity. Saving produces a new lesson with zero attendance; the original retains its three attendance records. |
| Minute input | A school time of 09:10 is accepted and saves; time fields accept whole minutes. |
| Delete confirmation | Choosing Keep retains the lesson; confirming Delete removes it from the calendar. |
| Failed delete and retry | Simulated failure leaves all 19 events visible; retry succeeds and reduces the count to 18. |
| Phone action access | At 390px width, the editor's **⋯** action control and menu remain usable and visible. |

Separate live API checks against an isolated disposable lesson confirmed creation and readback, HTTP 200 for soft deletion, absence from the next normalized snapshot, HTTP 200 when retrying the same delete mutation and HTTP 409 for a stale edit. The deleted row retained its UID and scheduled times. Only the unlinked probe was removed afterward; all 3,211 existing attendance rows retained their checked input values and links. No live Duplicate/Delete menu clicks were performed on this run.

Not established by these checks: physical touch/long-press behavior, Safari/Firefox compatibility, browser timezone emulation, recurring series, or teacher-specific access rules. The local development service account is not a production authorization model.

## Calendar visibility controls — 2026-10-14

Implemented Hide all / Show all and the teacher-row **Display this only** menu. JavaScript syntax checks, all 99 existing automated tests and all 19 vendor hashes pass. Code review covers separate checkbox/menu controls, keyboard handling, focus restoration and preservation of search/date/view. No Grist schema or record writes are involved.

**Browser verification is pending:** the browser tool rejected access to the local demo under its URL policy. No alternate browser route was used. The following are expected results to verify, not observations:

- Demo week: Hide all shows 0 lessons; Show all restores 18; Anna's Display this only shows 5 and selects only her checkbox.
- All three actions retain an active search, the current date and the current view. Individual checkboxes still work afterward.
- Opening or dismissing a teacher menu does not toggle its checkbox. Enter/Space and arrow keys open the menu; Escape restores focus; Tab continues through the sidebar controls. On a phone, Escape closes the menu before a subsequent Escape closes the drawer.
- At 390px, the menu button is visible without hover. Menus fit within the viewport and close on scroll, resize, outside click or sidebar dismissal.
- Refresh preserves Hide all and solo selection. Reset restores all teachers and the sample week. Existing lesson Duplicate/Delete menus still open and dismiss correctly.

## ALL_ATT model transition — 2026-10-15

The local Grist server now uses ALL_ATT for both lesson events and attendance. Earlier live browser checks above describe the former separate-table adapter. **Fresh interactive browser verification is pending** because the browser tool rejected local preview access under its URL policy; no alternate browser route was used.

Separate live HTTP/API checks against four disposable ALL_ATT rows verified:

- Individual creation uses one row with pending attendance; repeating the same create returns that row.
- Start-only edits preserve the existing end despite its trigger formula. Schedule and teacher edits update the canonical `start`, `end` and `t` cells.
- Group movement preserves a linked child's scheduling inputs and explicit parent link.
- Duplicate creates a fresh scheduled lesson with copied manual checklist and no copied or reassigned attendance.
- Cancellation and soft deletion preserve attendance. Deletion hides the event; repeating its mutation succeeds; stale editing and resurrection attempts return HTTP 409.
- Temporary rows were removed after checking their unique identities and origins. Original input cells remain unchanged except automatic timestamps on rows linked during preparation. The old Calendar_Lessons table is unchanged.

Pending browser checks: create a group and individual lesson using the new selectors; verify existing student/group references remain read-only; duplicate and change a copied reference; search a pending individual booking by student name; check dirty-draft recovery, keyboard focus and 390px layout with the added controls. Dragging/resizing needs another real-browser check against this adapter before claiming it has passed.

## DateRegistry context — 2026-10-15

**Interactive verification is pending.** The existing local-preview URL-policy restriction was respected; no alternate browser route was attempted. Automated helper checks establish explicit-closure rules, timezone conversion, exclusive midnight endpoints, safe text rendering and avoidance of duplicate live-region announcements. They do not establish rendered geometry or screen-reader behavior.

Expected browser checks, not observations:

- In an isolated date fixture, explicit Closed shows subtle week/day/month shading and a text label; holiday text is visible or available through date descriptions. Weekend alone does not mark a day closed.
- The lesson editor shows complete holiday/term/status text for the selected school dates. An end exactly at midnight does not include the following date. Save remains available on closed dates.
- Refresh after changing metadata updates date labels and an open editor without losing unsaved text, current date, view or teacher selections.
- Date labels remain contained at desktop and 390px widths; keyboard date controls and time-field descriptions remain usable. Long holiday names are safely truncated in compact cells, with full descriptive text available.
- Demo mode retains its existing appearance and behavior without registry data.

Separate live API checks verified 3,653 registry dates, correct source links for all dated attendance/transaction rows, unchanged lesson revision after metadata changes, date-link movement across school midnight, and lesson visibility with missing/duplicate registry dates. All temporary probes were removed. Original inputs and definitions were unchanged. These checks establish live data behavior, not browser rendering; see [STATE.md](STATE.md).

## Duration controls — 2026-10-15

Interactive browser verification remains pending under the existing local-preview URL restriction. No alternate browser route was used. Ten controller tests cover the three presets, custom lengths, start/end transitions, invalid input, timezone/midnight/leap/year boundaries and failed-save recovery. Four schema tests cover additive duration setup and preservation of existing definitions/revisions. Separate live Grist API checks verified the duration formula on all current rows and on a disposable lesson saved at 40, 60, 80 and 75 minutes; all original inputs/definitions/revisions were unchanged after cleanup.

Expected browser checks, not observations:

- Open a new lesson: 60 minutes is selected. Each preset changes End correctly; a late-night start crosses to the next school date.
- Existing/duplicated/drag-selected custom lengths display Custom with their minute count. Changing Start retains that length; editing End updates the selector without snapping.
- Selecting Custom focuses End. Keyboard navigation reaches the labelled selector; its hint describes automatic end changes. Check desktop and 390px dialog layout and scrolling.
- Refresh and a simulated failed save retain all unsaved times and the displayed duration. Saving disables the duration selector with the other inputs.
- Perform an actual pointer resize, reopen the lesson and confirm its resulting custom duration and Grist Duration_Minutes. Controller/API tests do not establish drag geometry.

## Editable Grist duration — 2026-10-16

The write adapter now translates UI endpoints to stored start/Duration_Minutes, with end calculated by Grist. Live HTTP/API tests passed creation, direct Grist minutes edits, stale-save rejection, duration-preserving moves, fractional resizing, metadata-only editing, mutation retries and deletion. All isolated fixtures were removed and original inputs preserved. Historical start-only-save behavior above is superseded: start-only moves now preserve duration.

Browser interaction remains unverified under the existing local-preview access restriction. In addition to the checks above, verify a fractional duration entered in Grist retains its seconds when opened, duplicated or saved after a title-only edit; then move/resize it using an actual pointer. HTTP/controller checks do not establish native datetime input behavior or drag geometry.

## Linked title capsules — 2026-10-16

Interactive verification remains pending under the existing local-preview URL restriction. The connected server's config, snapshot and updated editor assets returned HTTP 200; all 2,820 read-only lesson titles contained teacher-first reference names. The 288-test suite passes, including title controller/model/store checks. New-format saves were tested with isolated fixtures, not live writes.

Expected browser checks, not observations:

- The live title editor displays teacher first and student/group second as fixed capsules. Tab reaches the labelled text fields before and after the pair; both keep visible keyboard focus. The demo retains its original title input.
- Add text on both sides, change the teacher or a new lesson's student/group, and confirm only the appropriate capsule changes. Clear both sides to return to names alone.
- Save, reopen and duplicate a lesson with both additions. A duplicate with another student/group keeps the text but updates the name. Attendance stays with the source.
- Refresh after a reference rename and retry a failed save without losing custom text. An untouched existing title should not create a dirty draft or a title write.
- Check 390px layout, long names and historical multiple references. Capsules wrap without editing or clipping their text; the two input fields remain usable. The combined custom-text limit is 160 characters, excluding names.

## Searchable title chips — 2026-10-16

The live title chips now replace the separate teacher, lesson type, student and group-reference selectors. Interactive browser verification remains pending under the existing URL restriction. All 309 automated tests pass, including a small DOM/event harness for picker behavior and isolated store tests for inferred individual/group creation and retry. Read-only HTTP checks verified the updated assets and catalog (1,383 students, 13 groups, 17 eligible teachers); the identity controller's names matched all 2,820 saved lessons. No live writes were used for this UI update.

Expected browser checks, not observations:

- Open a new lesson and click either chip, or use Enter/Space/ArrowDown from the focused chip. Search by name, navigate with arrows, and select with Enter. Student/group options have distinct type labels even when their names match.
- Choose a student, then a group, then another student. The chip and saved lesson classification should follow the final choice with no leftover references or extra attendance. Group not assigned remains available. Added title text stays intact.
- Escape closes the picker before closing the editor. Tab moves to the next title control; Shift+Tab moves back. Clicking another chip switches pickers. Typing in search or pressing Enter on an empty result must not submit the lesson form.
- Saved lessons allow teacher selection and now permit same-kind subject correction (superseding the initial chip lock). Historical teacher/reference values remain readable. Duplicate opens a combined subject choice and requires an eligible teacher where the original assignment cannot be reused.
- Refresh, failed saves and unchanged uncertain retries retain the selected IDs and editable title parts. A catalog rename changes the chip text; removal of a new-choice entry does not silently replace the draft selection.
- Check desktop, 390px, short-window and touch layouts. The popup stays within the scrollable editor on narrow/short windows, options can be scrolled, long names wrap, focus is visible and the selected option is revealed when reopening. Confirm native combobox/screen-reader announcements separately.
- Demo mode retains its original title and teacher fields, simulated failure and Reset controls.

## Saved subject corrections and group-label removal — 2026-10-16

All 331 automated tests pass. Isolated controller/store tests cover saved individual/group corrections, unchanged historical references, stale and failed saves, retries, legacy title conversion, retained group metadata and the attendance-unavailable fallback after an acknowledged correction. The connected server and updated assets respond over HTTP; no live writes were used for this update. Native interaction remains unverified under the existing URL restriction.

Expected browser checks, not observations:

- Open a saved individual lesson, search the subject chip and select another existing student. Only student choices appear. The title additions survive and an unsaved note explains that this corrects the lesson and its own attendance record. Save/reopen should show the selected student on the same lesson.
- Open a saved group header and choose another group or Group not assigned. No students appear in this list. The notice explains that linked student attendance stays unchanged. The event subtitle must use the new group reference, never an old freeform label.
- The live editor has no Group label field. Demo retains its original Group field. New and duplicate live drafts still offer the combined student/group choice.
- Revert a changed choice and confirm the notice disappears and the draft is clean. Refresh and a failed save preserve the current unsaved selection and both title text parts.
- Simulate an acknowledged individual correction followed by a failed full refresh: reopening shows Refresh needed in attendance, never the old student or a misleading zero count. A successful Refresh data restores the current attendance.
- Repeat chip keyboard/focus, long-name and 390px checks above with a saved lesson and the new notice visible.
