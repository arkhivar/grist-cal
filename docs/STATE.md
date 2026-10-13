# Actual state

Updated: 2026-10-13 (Asia/Vladivostok).

## Foundation

- Local checkout established from arkhivar/grist-cal, original main commit `78bb31d`.
- Working branch: `codex/standalone-calendar-demo`.
- Accepted scope and data safeguards captured in AGENTS.md and PLAN.md.
- The existing `arkhivar/grist` repository was inspected read-only at `9bda49cdcfd4a23ff2c5c120cf4378737ded9f2e`.
- Development Grist service-account authentication and read-only schema access succeeded in the planning session. No Grist writes have been tested or made for this project.

## Implementation

The domain model, synthetic records and in-memory adapter are implemented. They provide explicit lesson/attendance identities, school-timezone conversion, delayed writes, version conflicts, one-shot failure simulation and a reset barrier.

FullCalendar Standard 6.1.21, its Luxon plugin, Luxon 3.7.2 and IBM Plex fonts are vendored with exact sources, licenses and hashes. `node scripts/verify-vendor.mjs` verifies all 19 bundled files.

`node --test tests/domain.test.js tests/memory-store.test.js` passes 17 tests, including timezone checks in UTC, America/Los_Angeles and Asia/Tokyo child processes. These are domain tests, not browser geometry tests.

The interface is being implemented; no browser interaction results are claimed yet. Local run commands and browser findings will be added with the working demo.

## Next

Complete and validate the standalone synthetic-data demo. Grist integration, recurrence and deployment remain later milestones.
