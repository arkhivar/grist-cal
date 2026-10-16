# Identity providers and authentication

Updated: 2026-10-16 (Asia/Vladivostok).

## Status and ownership

Authentication is under investigation, not implemented. The first infrastructure milestone is isolated self-hosted Grist staging with a proven restore; teacher access follows only after sign-in and authorization tests pass. [PLAN.md](docs/PLAN.md) holds the rollout sequence and [STATE.md](docs/STATE.md) records executed work. Puppet configuration belongs in the separate infrastructure repository. Schema changes, if needed, must be recorded in [COLUMNS.md](COLUMNS.md).

The current calendar runs on loopback with one Grist development service account. Host/Origin checks and a process write token protect local use; they do not identify a teacher. This credential must not become the shared backend identity for a teacher pilot merely by adding a login page.

## School identity source

The user reports standardized mailboxes hosted by HostUp/cPanel, accessed through webmail.se.city. PERFORMANCE rows labelled `team` are the staff enrollment roster. Existing stored fields are `name` (initials), `label` (classification) and `email`; no new column is needed for the initial roster audit.

Read-only audit on 2026-10-16: 17 exact team records, all with initials and populated email; 16 syntactically valid school-domain addresses and one invalid email entry; no team email duplicates anywhere in PERFORMANCE after trim/case normalization. The invalid entry needs correction before that person is enrolled. Mailbox ownership, delivery for every staff member and IdP accounts have not been verified. Individual addresses and row contents are intentionally absent from this log.

Mailboxes do not automatically provision Authentik accounts or synchronize passwords. Proposed enrollment is administrator-controlled invitations for reviewed team members, with verified addresses and MFA/recovery setup. Authentik supports [invitation-based enrollment](https://docs.goauthentik.io/users-sources/user/invitations/); no invitations have been sent.

## IdP options verified in current documentation

Authentik remains the leading candidate because the user also operates NetBird and plans managed Kubuntu accounts. No IdP has been selected/deployed in this track. Verify capabilities against the actual pinned Grist release before configuration.

| Route | Documented capability | Outstanding work |
| --- | --- | --- |
| Activated Grist + Authentik OIDC | Grist documents native OIDC with activation/full edition; Authentik can act as the OIDC provider | Confirm edition/activation eligibility, configure and test claims, enrollment, logout and recovery |
| Grist Community + Authentik proxy | Grist supports forwarded identity headers; Authentik supplies authenticated proxy headers | Implement and prove proxy trust boundary, prevent backend bypass, and validate a per-user calendar API path |
| Sign in with getgrist.com | Grist documents this as an available self-hosted login option | Possible administrator bootstrap option; retains external login dependency and does not establish shared school IdP integration |

Sources: [Grist authentication overview](https://support.getgrist.com/install/authentication-overview/), [OIDC](https://support.getgrist.com/install/oidc/), [Authentik proxy](https://docs.goauthentik.io/add-secure-apps/providers/proxy/). Current eligibility for free Grist activation must be confirmed; no subscription or trial is assumed.

For OIDC, use the configured issuer, exact callback URL and `openid email profile` scopes. Grist checks verified email by default. Authentik's documented behavior since 2025.10 requires configuring actual email verification; do not globally assert `email_verified=true` or disable the check to make a test pass. See [Authentik email verification](https://docs.goauthentik.io/add-secure-apps/providers/oauth2/verify-email-address/).

For proxy authentication, strip/overwrite every client-supplied identity header and block direct access to the Grist backend. Grist's forwarded-header redirect flow assumes a single team site; session behavior depends on configuration. Test anonymous requests, header spoofing, logout and WebSockets. See [Grist forwarded headers](https://support.getgrist.com/install/forwarded-headers/).

## Proposed identity and authorization contract

These are implementation requirements/recommendations for the pilot, not deployed behavior:

- Link the calendar's validated IdP issuer/immutable subject to one reviewed PERFORMANCE row ID. Use email for initial enrollment matching, not as a freely changeable privilege selector. Reject missing, duplicate, invalid or ineligible matches. Do not create identities from initials.
- Keep roster identity fields and role assignments administrator-controlled. Team membership establishes eligibility, not administrator rights. Define onboarding, email changes, reassignment, leavers and emergency recovery; revoke sessions and delegated credentials on removal.
- Grist's current OIDC implementation builds a user profile from email/name. The proposed immutable calendar mapping does not describe Grist's internal identity model. Test email changes/reuse explicitly to avoid merging or inheriting another person's access. See [Grist OIDC source](https://github.com/gristlabs/grist-core/blob/main/app/server/lib/OIDCConfig.ts).
- Require MFA with explicit enrollment and tested recovery, especially for administrators. Authentik policies can skip unenrolled users unless configured to require an authenticator. See [authenticator validation](https://docs.goauthentik.io/add-secure-apps/flows-stages/stages/authenticator_validate).
- Agree a role matrix before granting pilot access: assigned versus other teachers' lessons; student/group lookup and attendance visibility; creating, reassigning, cancelling and deleting lessons; coordinator exceptions. Existing salaries/financial fields must be considered separately even when stored on the same ALL_ATT row. Attendance remains read-only in the calendar.
- Enforce the agreed policy in Grist and the calendar server. Hiding a teacher or column in the UI is not permission enforcement. Ordinary teachers must not gain schema/formula editing or unrestricted document exports to satisfy an integration shortcut. [Grist access rules](https://support.getgrist.com/access-rules/) describe the data and structure controls.

## Calendar API changes required before pilot

Local inspection found a single `store`, a shared in-flight snapshot and a process-wide write token in `server/http.mjs`. `server/grist-client.mjs` reads projected columns through `/sql`. Grist's current SQL implementation requires full-document copy access, so these queries cannot be retained by simply granting restricted teachers more permissions. See [runSQLQuery](https://github.com/gristlabs/grist-core/blob/main/app/server/lib/runSQLQuery.ts).

Preferred candidate for activated Grist: delegate each teacher through a Grist OAuth app with document-scoped read/write permission, authorization code plus PKCE, and confidential client secrets/tokens kept server-side. Grist's self-hosted OAuth apps require full edition; their supported endpoints include table records, not the current SQL path. An Authentik token is not automatically a Grist API token. See [Grist OAuth apps](https://support.getgrist.com/oauth-apps/).

For Community, prove a supported per-user API authentication path alongside the proxy integration before selecting it for the pilot. Per-user API keys carry the owner's rights but require explicit storage/rotation/revocation design; a shared owner key is not an equivalent substitute. See [API authentication](https://support.getgrist.com/rest-api/). No final transport decision has been made.

Required adapter/server work:

1. Replace SQL projections with supported record endpoints, retaining explicit field minimization and handling ACL-censored values safely.
2. Bind every request to a validated user and that user's authorized document. When accepting a Grist OAuth grant, verify its Grist user matches the intended calendar identity before storing it; test switching Grist accounts during consent. Isolate credentials, caches and in-flight work by identity; use per-session CSRF protection, secure cookies and expiry/logout handling.
3. Verify reference lookup, formula visibility, conditional upserts, revision checks and retry recovery under the actual restricted role. Preserve narrow schedule writes and historical teacher-reference handling.
4. Prevent cross-user data in readbacks, errors and post-save snapshots. Test revocation while an editor is open and while requests are in flight.

## Pilot acceptance evidence

Use administrator, two distinct teacher identities and a disabled/non-team identity on staging. Test both browser flows and direct HTTP/API calls:

- Correct login/roster mapping; anonymous and ineligible users denied; spoofed identity and direct backend bypass denied.
- Allowed work succeeds and disallowed cross-teacher reads/writes, financial-column reads, schema edits and exports fail according to the agreed role matrix.
- Attendance/parent links remain intact; scheduling, deletion, conflicts and uncertain retries retain existing guarantees under restricted credentials.
- Simultaneous users cannot share snapshots or credentials; logout, role removal, expired tokens and recovery behave as documented.
- A restored instance recovers accounts/permissions and IdP dependencies, with documented session invalidation and administrator recovery.

## Progress log

| Date | Work | Evidence/status |
| --- | --- | --- |
| 2026-10-16 | Opened infrastructure track; reviewed server and official auth options | Discovery complete; no runtime auth change |
| 2026-10-16 | Read existing PERFORMANCE schema and projected roster fields | Aggregate audit above; no data/schema writes |
| 2026-10-16 | Cloned and inspected arkhivar/puppet, the private fleet-wide repository | No existing Grist/Authentik deployment; per-node profiles, Hiera/eyaml, NetBird-only management; no changes made |
| Pending | Establish staging host, backup destination and Grist edition | Needed before host implementation |
| Pending | Select IdP/API route, correct invalid roster entry, define roles | No accounts, invitations, access rules or identity schema created |
| Pending | Deploy, test identity/permissions, include auth in restore drill | Teacher pilot remains gated |

NetBird identity changes require inspection of its running deployment first; [NetBird documents external IdP integration](https://docs.netbird.io/selfhosted/identity-providers). Repository inspection found Puppet-managed local users with fixed UIDs/home directories and separate infrastructure/workstation SSH policies. Future LDAP/SSSD enrollment must preserve UID/home ownership, account for name conflicts and test offline login. This remains a later, separate change; no mailbox password or local account migration was performed.
