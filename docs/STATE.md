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

The standalone interface is implemented: week/day/month/agenda, date navigation, teacher visibility, search, lesson editor, click/drag creation, moving/resizing, cancellation, manual checklist text, and linked read-only attendance. It uses the pinned Grist colors and local IBM Plex fonts. Phone-width screens start in Day view with a sidebar drawer.

The demo labels its fictional data and in-memory lifetime. Reload and Reset restore the sample week. Demo tools offer a one-shot failed save and a refresh; refreshing an open editor keeps its draft. Saves have version checks and preserve attendance. Unsaved edits prompt before closing.

Run with `node scripts/serve.mjs`, then open http://127.0.0.1:4173 in a dedicated browser tab. No dependency installation or build step is needed. The local server listens only on loopback and serves only the app and its public assets.

## Verification

- `node scripts/check.mjs`: syntax checks, all 19 vendored-file hashes, and 18 passing tests (17 domain/store plus server boundary checks).
- Interactive browser checks passed at desktop widths and 390px phone width. Verified actual pointer dragging, resizing, selection creation, failed-save recovery, retained attendance, teacher filters/search, all four views, navigation, cancellation, manual checklist round-trip, draft refresh, dirty-close confirmation, reset, and keyboard focus recovery. Details and reproducible steps are in [BROWSER_CHECKS.md](BROWSER_CHECKS.md).
- Browser testing found and fixed a selection-preview crash caused by temporary events lacking teacher metadata. Creation and subsequent view switching were rechecked; no new console errors were observed after the fix.
- GitHub Actions runs the same checks on pushes and pull requests. Local results do not imply a hosted CI run has completed.

The browser checks are interactive, not an automated end-to-end suite. Physical touch devices and other browser engines remain untested. Cross-browser-timezone correctness is covered by domain tests; browser timezone emulation was not available in this session.

## Next

Review the demo's usability, then add a read-only Grist adapter and explicit lesson/attendance mapping. `ALL_ATT` remains the main attendance source. New columns may be added where justified; existing columns must never be deleted. Live Grist writes, recurrence, authentication and deployment remain later milestones. Puppet can manage the eventual Kubuntu login configuration after an Authentik pilot.
