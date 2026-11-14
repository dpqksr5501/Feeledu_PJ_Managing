# Security review — 2026-11-11

Scope: repository and isolated Node/Cloudflare tests. No brute-force attempts or test personnel records were written to production. This is a focused application review, not a certification or exhaustive penetration test.

2026-11-14 display/profile follow-up: `owner` is displayed as 개발자; stored roles, owner-only endpoints and manager permissions do not change. Authenticated `PATCH /admin/profile` only accepts `name` and `expectedName`, always targets the authenticated ID, checks concurrent renames and audits changes atomically. It preserves sessions; credential resets and deactivation retain their existing session revocation rules. Calendar colours reuse cached holiday dates without extra API calls and give holidays priority over Saturday. Native/PWA display detection only hides an installation promotion and never grants permissions; no app-state flag is persisted in shared localStorage. Browser tests simulate native referrers separately from ordinary Chrome; they do not certify every physical tablet. Detection follows [Google's PWA guidance](https://web.dev/learn/pwa/detection/).

2026-11-14 night-premium follow-up: precise break intervals use bounded authenticated record APIs, normalized UTC timestamps, existing optimistic revisions and atomic audit writes. The server rejects overlapping/out-of-shift intervals and inconsistent totals; older clients cannot implicitly erase intervals. Schema-5 snapshots include break intervals, restore foreign keys and validate interval consistency inside the import transaction. Schema-3/4 restores remain supported; original settlement JSON is not rewritten. Indexed batch break reads avoid per-employee queries. See [night calculation scope and official sources](NIGHT_SHIFTS.md).

## Remediated

- Cloudflare static HTML bypassed Express Helmet. Static asset headers now apply CSP, anti-framing, MIME sniff prevention, referrer/permissions restrictions and HTTPS HSTS.
- Login previously only limited requests by IP. Persistent account failure backoff now covers known and unknown usernames; password proof for backup/password changes shares a separate account backoff. Blocked requests do not prolong the block.
- Password storage uses versioned scrypt N=16384, r=8, p=5 (16 MiB). Existing p=1 hashes remain verifiable and upgrade after successful login. Malformed hashes fail closed; an unknown username uses a cached dummy hash.
- At the user's request, new and changed administrator passwords require at least 10 characters and one punctuation/symbol character. Whitespace, Korean/other letters and digits alone do not meet the special-character requirement. Existing passwords remain usable for login until changed.
- At the user's explicit request, the current administrator UI retains login without idle, background, or 12-hour locks. Existing authenticated sessions are promoted only for their own token. After the user delegated the retention design, the implementation uses a rolling seven-day expiry instead of the proposed year. Renewal is based on persisted expiry, at most daily on existing requests; a static open screen checks once per day. Logout, account deactivation, and password resets invalidate sessions. Legacy/temporary API logins without keepSignedIn retain idle/absolute limits. Auth state remains outside business snapshots.
- Full backups require owner permission plus current password via POST. Password changes also have request and account failure limits.
- Existing CI actions are pinned to commit hashes. Checkout does not retain credentials. Signing and deployment secrets stay in encrypted GitHub Secrets, outside built artifacts.

## Retained controls and limits

SQL values use bound parameters. Mutating API calls require a same-origin custom request header, check Origin when supplied, and use SameSite=Strict session cookies with HttpOnly/Secure in production. Kiosk devices require a revocable pairing token; the kiosk API does not return pay data. Offline submissions require review before payroll acceptance. Native release signatures must match the website's Digital Asset Links identity.

Phone last four digits identify a person; they do not prove the person entered their own number. Physical supervision remains necessary for this requested flow. Browser/device compromise can expose a paired device token. Revoke lost tablets in settings. Owners should replace test passwords before real use, enable GitHub/Cloudflare MFA, and protect exported payroll backups and the permanent APK signing key.

Dependencies: `npm audit` includes production and development packages. Run it again with future upgrades; a clean result only addresses published dependency advisories.

## Reliability follow-up (2026-11-12)

2026-11-12 reliability follow-up: queued clock events now require a valid JSON acknowledgement before removal. Retry backoff respects `Retry-After` and stops for revoked tokens; Web Locks serialize shared queues across supported browser tabs. Saturated Cloudflare request limits no longer keep incrementing persistent counters. Owner/password backup controls remain in place, and JSON integrity checking runs locally without uploading the file. Additive indexes and bounded period queries preserve schema-3 backup compatibility. See [operations and measured query costs](OPERATIONS.md) for backup, restore and free-tier limits. These checks are not a guarantee against all defects or attacks.

## Holiday integration (2026-11-13)

2026-11-13 holiday integration: provider credentials are optional server secrets and are excluded from all snapshots. Outbound requests use a fixed HTTPS endpoint, disallow redirects, bound response size/time/concurrency/pages and reject DTD/entities. Complete calendars are applied transactionally; withdrawals require versioned administrator review. Manual holidays and finalized settlements are preserved. Tests use synthetic provider responses and explicitly clear local provider credentials. See [setup and failure handling](HOLIDAY_API.md). Live provider authentication requires the owner's key and is separate from fixture verification.

## References

- https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- https://developers.cloudflare.com/workers/static-assets/headers/
