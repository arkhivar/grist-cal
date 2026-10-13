# First implementation task

Build a local standalone calendar demo using invented records. The main screen must be usable in a dedicated tab, with Google Calendar-inspired layout and the pinned Grist widget visual style.

## Acceptance

- Show a week with varied, overlapping lessons and four independently visible teachers.
- Provide Today, previous/next, date selection and day/week/month views.
- Create a lesson by button or calendar selection; edit title, teacher, group, times, room, participant text, checklist, status and notes.
- Open a lesson to inspect its linked fictional student-attendance rows.
- Drag and resize real rendered events, keeping attendance links and marks unchanged.
- A failed save visibly restores the previous event; the editor preserves unsaved input on a rejected save or data refresh.
- Reject invalid times and stale record versions. Reset safely restores the initial fixtures, including when a save is pending.
- Render school times identically in browsers outside Vladivostok.
- Label the app Demo, explain that changes last until reset/reload, and provide reset/failure controls.
- Keep vendor assets local and pinned with notices. Use only standard calendar features.
- Run meaningful automated tests and actual browser interaction checks; record the results and remaining limits in STATE.md.
- Commit and push completed updates to the feature branch. Finish with the local app ready for usability review.
