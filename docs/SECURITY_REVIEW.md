# Security review — 2026-11-11

Scope: repository and isolated Node/Cloudflare tests. No brute-force attempts or test personnel records were written to production. This is a focused application review, not a certification or exhaustive penetration test.

## Remediated

- Cloudflare static HTML bypassed Express Helmet. Static asset headers now apply CSP, anti-framing, MIME sniff prevention, referrer/permissions restrictions and HTTPS HSTS.
- Login previously only limited requests by IP. Persistent account failure backoff now covers known and unknown usernames; password proof for backup/password changes shares a separate account backoff. Blocked requests do not prolong the block.
- Password storage uses versioned scrypt N=16384, r=8, p=5 (16 MiB). Existing p=1 hashes remain verifiable and upgrade after successful login. Malformed hashes fail closed; an unknown username uses a cached dummy hash.
- Administrator sessions have server-enforced idle limits (PC 30 minutes, shared tablet 2 minutes) and a 12-hour absolute deadline. Background polling does not renew them. Operational auth tables do not alter the business snapshot schema.
- Full backups require owner permission plus current password via POST. Password changes also have request and account failure limits.
- Existing CI actions are pinned to commit hashes. Checkout does not retain credentials. Signing and deployment secrets stay in encrypted GitHub Secrets, outside built artifacts.

## Retained controls and limits

SQL values use bound parameters. Mutating API calls require a same-origin custom request header, check Origin when supplied, and use SameSite=Strict session cookies with HttpOnly/Secure in production. Kiosk devices require a revocable pairing token; the kiosk API does not return pay data. Offline submissions require review before payroll acceptance. Native release signatures must match the website's Digital Asset Links identity.

Phone last four digits identify a person; they do not prove the person entered their own number. Physical supervision remains necessary for this requested flow. Browser/device compromise can expose a paired device token. Revoke lost tablets in settings. Owners should replace test passwords before real use, enable GitHub/Cloudflare MFA, and protect exported payroll backups and the permanent APK signing key.

Dependencies: `npm audit` includes production and development packages. Run it again with future upgrades; a clean result only addresses published dependency advisories.

## References

- https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- https://developers.cloudflare.com/workers/static-assets/headers/
