# Sources and provenance

## Design reference

- Repository: https://github.com/arkhivar/grist
- Reviewed revision: `9bda49cdcfd4a23ff2c5c120cf4378737ded9f2e` (widget version 7.60).
- `shared/base.css`: visual tokens, font choices, focus and control styling. Adapt visual properties only; iframe-specific sizing is unsuitable for a standalone app.
- `shared/dates.js`: explicit school-timezone display and separation of UTC instants from local wall-clock input.
- Reference license: MIT, copyright 2026 arkhivar. Full notice retained in THIRD_PARTY_NOTICES.md with the demo assets.

## Technical references

- FullCalendar v6 globals: https://legacy.fullcalendar.io/v6/initialize-globals
- FullCalendar v6 plugin list: https://legacy.fullcalendar.io/v6/plugin-index
- Grist REST API: https://support.getgrist.com/api/
- Grist OAuth apps and edition availability: https://support.getgrist.com/oauth-apps/
- Grist forwarded authentication: https://support.getgrist.com/install/forwarded-headers/
- Authentik proxy authentication: https://docs.goauthentik.io/add-secure-apps/providers/proxy/
- NetBird / Authentik: https://docs.netbird.io/selfhosted/identity-providers/authentik
- Authentik / SSSD for a future Linux login pilot: https://integrations.goauthentik.io/infrastructure/sssd/

## Grist integration references

Reviewed for the sandbox integration on 2026-10-13. The upstream source links below follow `main`; runtime behavior was also checked against the development document. No upstream source is loaded dynamically by the application.

- [REST API usage](https://support.getgrist.com/rest-api/) and [API reference](https://support.getgrist.com/api/): projected reads, schema additions, record upserts, `noadd`, `noupdate`, `onmany` and `noparse`.
- [Grist data format](https://github.com/gristlabs/grist-core/blob/main/documentation/grist-data-format.md): DateTime epoch seconds, references and reference lists. SQL reads return stored list JSON in this deployment; `server/grist-client.mjs` decodes only known reference-list columns.
- [Upsert implementation](https://github.com/gristlabs/grist-core/blob/main/app/plugin/TableOperationsImpl.ts) and [result contract](https://support.getgrist.com/code/interfaces/DocApiTypes.BulkAddOrUpdateRecordResult/): returned record IDs distinguish matches from no-ops. A no-op alone is not an error response.
- [Engine user actions](https://github.com/gristlabs/grist-core/blob/main/sandbox/grist/useractions.py): matching and updating records. Live testing established that RefList arrays cannot be used directly as `require` predicates; this app instead matches scalar formula revisions.
- [Action serialization and persistence](https://github.com/gristlabs/grist-core/blob/main/app/server/lib/Sharing.ts): serialized document actions and transactional storage of action bundles.
- [Formula and action exception handling](https://github.com/gristlabs/grist-core/blob/main/sandbox/grist/engine.py): formula errors may become cell error values. The app uses a regular hash formula for comparison, not a trigger formula that attempts to abort a write.
- [Formula behavior](https://support.getgrist.com/formulas/): formula columns recalculate from their dependencies. Exact revision definitions are kept in `server/schema.mjs` and checked by explicit setup.
- [API limits](https://support.getgrist.com/limits/#api-limits): document concurrency, request size and plan limits. Import batches are bounded, and the client retries eligible reads rather than blindly retrying mutations.

The current implementation uses the pinned v6 standard calendar line. Do not silently upgrade major versions: API, styling and licensing must be reviewed. Exact bundled asset versions, source URLs and hashes are recorded in vendor/manifest.json.

Product requirements come from the user's handoff discussion and subsequent instructions in this project. No private document identifiers, credentials or school records are included here.
