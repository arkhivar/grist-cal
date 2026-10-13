# Project guidance

## Product and scope

- Build a standalone full-window calendar first. Google Calendar guides layout and interaction; `arkhivar/grist` supplies visual tokens, typography and suitable control patterns.
- Current milestone: local read/write Grist sandbox integration, explicitly authorized by the user. Keep the synthetic demo available and the data adapter independent of the calendar UI. Recurrence, Authentik, NetBird and Puppet deployment remain later work.
- Display and edit lesson times in `Asia/Vladivostok`; use explicit UTC ISO strings in the app and epoch seconds at the Grist boundary. Never use the browser's local timezone implicitly.
- Give lessons an explicit type and stable identity. Student-attendance rows, including incomplete rows with an empty student reference, must never become events.
- Attendance is per student, linked by lesson ID. Scheduling does not mark attendance. Cancellation preserves records. Manual checklist fractions remain manual.
- Duplicate opens an unsaved lesson with copied scheduling details and manual checklist, a fresh identity, scheduled status and no attendance. Save creates the copy; never copy or reassign source attendance.
- Delete is a confirmed soft deletion: write only `Calendar_Lessons.Status=deleted` and `Mutation_ID`, preserve the source row and all attendance links, and hide the event from calendar views. Failed/stale requests must not hide it; a stale editor must not resurrect it. Recovery currently uses a status change in Grist, with no in-app undo.
- Confirmed import mapping: exact ALL_ATT.datetime + sorted per teacher references + group2 group references define a lesson. For indie/trial groups and records without a group, also include student references. Imported lessons initially last 60 minutes. Preserve missing/multiple teacher references; do not infer present/absent from payment values or notes.
- Calendar_Lessons owns scheduled times. ALL_ATT.Calendar_Lesson links historical attendance. Lesson moves never silently rewrite legacy attendance dates, wages, payments or formulas.

## Data and authorization

- The user has authorized development access to a shared Grist sandbox. `ALL_ATT` means all attendance and is the main attendance table. Production currently uses SeaTable.
- The user explicitly permits adding new Grist columns when needed without asking again. **Do not delete existing columns.** Preserve existing values and formulas, and account for the parallel salaries project when testing writes. Use isolated fixtures or a test copy for destructive/automated scenarios.
- Never commit credentials, real school records, private document URLs, logs containing personal information, `.env` files or document backups. Keep integration secrets server-side. A development service account is not the future teacher permission model.
- The reference repository is read-only. Reuse pinned, attributed pieces; do not load its moving main branch at runtime.

## Working and delivery

- Work locally, commit and push after each meaningful verified update (explicit user authorization). Use a `codex/` branch unless directed otherwise. Do not force-push.
- Keep documentation accurate about what is implemented, tested and pending. Do not claim a mocked write proves live Grist integration.
- Run meaningful tests for record identity, timezone conversion, failed saves, draft preservation and concurrency behavior. Test geometry-dependent dragging/resizing in a real browser; DOM-only tests do not establish that these work.
- Keep the first demo in memory with a visible Demo label and Reset control. Include a repeatable simulated failed-save path.
- Preserve accessibility: keyboard-operable controls and event alternatives, visible focus, labelled inputs, dialog focus management, reduced motion, readable overlap and narrow-screen behavior.
- No deployment is required for this local usability milestone. Authentik/Linux login can later be rolled out with the user's Puppet infrastructure.
