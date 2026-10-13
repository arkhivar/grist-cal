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

The current implementation uses the pinned v6 standard calendar line. Do not silently upgrade major versions: API, styling and licensing must be reviewed. Exact bundled asset versions, source URLs and hashes are recorded in vendor/manifest.json.

Product requirements come from the user's handoff discussion and subsequent instructions in this project. No private document identifiers, credentials or school records are included here.
