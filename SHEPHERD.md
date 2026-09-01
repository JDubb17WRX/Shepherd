# Shepherd

Shepherd 7.6.2 is the Elkins Park Reformed Presbyterian Church management portal. It is a branded fork based on [ChurchCRM 7.6.0](https://github.com/ChurchCRM/CRM/tree/7.6.0), licensed under the MIT License. The upstream `LICENSE` file and attribution are intentionally retained.

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

## Bulletin console identity

`GET /shepherd/api/background/console/session` answers one question: which
Shepherd account is this browser session? It exists so the Elkins Park nginx
gateway can put an `auth_request` in front of the proxied bulletin console and
forward a *trusted* username to the upstream.

- **200** — the caller holds a completed local browser session. The canonical
  username is in the `X-Shepherd-Username` response header, and repeated in the
  JSON body for anyone holding curl.
- **401** — no session at all.
- **403** — the session is not a completed local browser login (API key, pending
  two-factor, mid-password-change), or the account's username has no canonical
  form.

Canonical means trimmed, lowercased, and matching `[a-z0-9._-]{3,50}` — the same
rule the website repo's `src/lib/roles.ts` applies to its roles file. The two
must not drift: a username that normalises differently on each side matches
nothing and denies access without saying why. A username with no canonical form
is refused here rather than passed on, so the refusal is visible at the endpoint
instead of appearing as an unexplained denial further downstream. The pattern
also keeps CR and LF out of the response header.

This is **not** the website-editor session endpoint, and it deliberately cannot
be. That one is Administrator-only — the console also serves Elders and Deacons
— and it answers in a JSON body, which `auth_request_set` cannot read.

**It does not decide what the caller may do.** Roles live in the website repo's
version-controlled `src/data/roles.json` so that adding an Elder shows up in a
diff. Every authenticated account gets a username back, including accounts with
no console role; an unrecognised username resolves to no role downstream and is
refused there. Do not add a permission check here — splitting the role decision
across two systems is the failure this arrangement exists to avoid.

It is mounted under `/background` on purpose: `AuthMiddleware` skips the
`tLastOperation` bump for those paths. nginx probes this endpoint on every
request to a proxied path, so mounting it elsewhere would refresh the idle timer
continuously and no console session would ever expire. For the same reason, an
anonymous probe logs at debug rather than warning.

### What the gateway must do

- `auth_request_set $shepherd_username $upstream_http_x_shepherd_username;`, then
  pass it upstream as a header.
- **Overwrite that header unconditionally on every proxied location**, including
  when the subrequest returned nothing. A browser must never be able to supply
  its own identity by sending the header inbound.
- Send `Accept: application/json` on the subrequest, as the existing editor gate
  does. The path already contains `/api/`, which is what actually forces a JSON
  answer, but the header keeps that from depending on the route's spelling.
- Do not cache the subrequest. The response is `no-store` and `Vary: Cookie`, and
  the session is rechecked on every call by design.
- Keep `proxy_hide_header Set-Cookie` on the auth_request location, as the
  existing website-editor gate already does. A subrequest's cookie has no
  business on the main response even when, as here, there should not be one.

A signed-out probe creates **no server-side session**. `Include/LoadConfigs.php`
skips session initialisation for an anonymous GET to this path, alongside the
website-editor probe and the public content reads. That is what makes the
endpoint safe to call on every single request to a proxied path; without it each
logged-out visitor would leave a trail of session files nobody ever reads. The
Cypress spec asserts the absent `Set-Cookie`, so losing the exemption fails a
test rather than quietly filling a disk.

## Logins are names, not email addresses

A Shepherd login must match `[a-z0-9._-]{3,50}` once trimmed and lowercased.
`ChurchCRM\Shepherd\Username` is the only definition of that rule, and
`UserService`, `SignupService`, and the console session endpoint all defer to
it. The website repo's `src/lib/roles.ts` mirrors it; the two have to move
together.

Upstream ChurchCRM accepts any login of three characters or more, and this
fork's admin user editor used to **pre-fill the field with the person's email
address** — which is where logins like `tony.wade@example.com` came from. Such
an account signs in to Shepherd normally and is then refused by the bulletin
console, which cannot resolve it, with nothing on screen to say why. An address
is also a delivery mechanism rather than an authentication subject, and it
moves when someone changes mail provider.

So the editor now suggests the local part of the address, falling back to
`first.last`, and refuses an address on save with a message that names the
problem.

**Existing accounts are grandfathered.** `UserService::updateUser()` enforces the
format only when the login actually changes, so an administrator is never locked
out of the permission checkboxes by a login somebody created years ago. Renaming
such an account does have to produce a conforming name. Nothing rewrites stored
logins, and sign-in is unaffected — it matches the stored value either way.

A grandfathered account still cannot use the console. The session endpoint logs
that refusal at warning with the user id, which is the intended way to find out.

## Volunteer signup sheets

The `signup-sheets` core plugin builds sheets of claimable slots — what to
bring, which shift to take, who is serving when. Staff work inside the CRM at
**Events → Signup Sheets**; volunteers without an account claim slots through a
shareable secret link.

Public pages live on the unauthenticated `/external` app:

- `/shepherd/external/signup-sheets/{sheetToken}` — the sheet
- `/shepherd/external/signup-sheets/{sheetToken}/claim` — claim a slot
- `/shepherd/external/signup-sheets/manage/{claimToken}` — the volunteer's own signup
- `/shepherd/external/signup-sheets/manage/{claimToken}/cancel` — release it

`/external` has no `AuthMiddleware`, so **authorization here is entirely by
unguessable token**. Both tokens are `bin2hex(random_bytes(16))` — 128 bits of
CSPRNG output, stored unique. The sheet token only resolves while the sheet is
explicitly published (`shs_is_public = 1`), and a claim is refused once the
sheet leaves open status or passes `shs_close_at`. Knowing a sheet token never
reveals a claim token, so one volunteer cannot cancel another's signup.

Public pages show **names only**. Email and phone are collected on the claim
form and are visible to staff inside the CRM, but are never rendered on a
public page. Visitor IP addresses are only ever stored as a SHA-256 hash in
`signupaudit_sga`, which is what the hourly per-visitor rate limit counts.

Three plugin settings govern the public surface: `allowPublicSheets` (off
disables share links entirely), `publicRateLimit` (claims per hour per IP,
default 20), and `contactEmail` (shown on public sheets).

Schema is `signupsheet_shs`, `signupslot_sls`, `signupclaim_sgc` and
`signupaudit_sga`, created by the 7.6.2 migration and by the fresh-install
schema — the two definitions are kept byte-identical.

**This plugin introduced `publicRoutesFile`.** A plugin that declares one in
its `plugin.json` gets that file mounted on `/external` by
`PluginManager::registerPublicPluginRoutes()`. It is a general mechanism, not
specific to signup sheets: any plugin can now expose anonymous routes, and any
plugin that does so owns its own authorization. Plugins that omit the key
expose nothing publicly.
