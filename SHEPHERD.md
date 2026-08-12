# Shepherd

Shepherd 7.6.1 is the Elkins Park Reformed Presbyterian Church management portal. It is a branded fork based on [ChurchCRM 7.6.0](https://github.com/ChurchCRM/CRM/tree/7.6.0), licensed under the MIT License. The upstream `LICENSE` file and attribution are intentionally retained.

## Upstream baseline and updates

- Baseline: tag `7.6.0`, commit `9b5993c0918ce45522e57f28114929ac75a29b9b`.
- This baseline includes the 7.6.0 XSS, SQL-injection, and 2FA-failure throttling fixes. Shepherd's stricter authentication, API-token eligibility, session invalidation, and administrator reauthentication controls remain layered on top.
- Keep Shepherd-specific code in `ChurchCRM/Shepherd`, the Shepherd route/view files, branding files, and `docker/shepherd` where practical.
- For an upstream update, create a temporary branch from the desired signed/released tag, merge or cherry-pick Shepherd commits, run the full upstream build/test suite, review security headers and self-service authorization, then deploy to a staging database restored from a production backup.

## Production assumptions

The application is served only at `/shepherd/` behind the same-origin Elkins Park Nginx gateway. FrankenPHP listens internally on port 8080. MariaDB is not exposed publicly. X-Frame-Options and CSP allow framing only by the same origin.

Required secrets are injected through the website compose `.env`: database passwords and `SHEPHERD_AUDIT_KEY` (a random value of at least 32 bytes). SMTP credentials are optional while recovering the base stack but are required before verification and password-setup mail can work. Production email uses Gmail SMTP over STARTTLS; use the full Gmail address and a dedicated Google app password, never the account's normal password.

Back up both the MariaDB volume and the persistent `Images`, `uploads`, `SQL`, `logs`, and `tmp_attach` volumes before upgrades. Test restoration regularly. A new installation uses ChurchCRM's setup flow to create its initial administrator; administrators must enroll in 2FA before using the application.

## Health endpoints

- `/shepherd/livez` is a dependency-free liveness check. It returns `200` when the Shepherd web process can answer requests.
- `/shepherd/healthz` is the container readiness check. It returns `200` only when MariaDB is reachable, the `config_cfg` application table exists, and Shepherd's required persistent paths are present and writable. Otherwise it returns `503` without exposing connection details.
- Readiness reports whether SMTP is configured, but deliberately does not open an SMTP connection on each health request. Delivery must be tested separately with Shepherd's email diagnostic and an isolated mail sink before release.

## Public website text editing

Public pages can read published plain-text overrides from
`/shepherd/api/public/website-content/{page}`. A passive capability request at
`/shepherd/api/background/website-content/session` returns a CSRF token only for an
Administrator with a completed local browser login. Updates use
`PUT /shepherd/api/website-content/{page}` and require that same browser session,
Administrator authorization, CSRF validation, and the latest document revision.

Content is stored in the versioned `shepherd_website_content` MariaDB table created by
the 7.6.1 database migration (and by the fresh-install schema). Values
contain only a static base string and a replacement string; the public site applies them
with `textContent`, never HTML. Conflicting revisions return `409`, and API-key-only
authentication is explicitly rejected so website editing always uses Shepherd's login.
