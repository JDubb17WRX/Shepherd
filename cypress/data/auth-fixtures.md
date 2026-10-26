# Shepherd authentication fixtures

The SQL seed enrolls Admin (1) and the locale administrator (906) in 2FA.
Their test-only TOTP secret is `JBSWY3DPEHPK3PXP`, encrypted using the seed's
`sTwoFASecretKey`. These values belong only to disposable test databases.
The seed resets the last-used TOTP timestamp to zero on every database reset.
Account roles, API keys, passwords, and the negative authentication fixtures
retain their existing values.

Validate API authentication after loading the seed:

```sh
npx cypress run --config-file cypress/configs/docker.config.ts --spec cypress/e2e/api/private/admin/private.auth-fixture.spec.js
```

Run this against both the root and subdirectory test stacks. Shared browser login
helpers complete the seeded administrators' TOTP challenge and validate portal
access. Each fresh login waits up to 31 seconds for a new server-time interval
to avoid single-use code replay. Cached sessions avoid that wait.

The browser regression spec is `cypress/e2e/ui/user/auth-fixture-session.spec.js`.
Specs that submit login forms directly still need to adopt the shared helpers.
Fresh-install tests enroll through the UI and retain the generated factor in a
Node-side task for the duration of that Cypress run. Run specs 01–05 in order
against an empty disposable database. Restoring the seed switches the remembered
factor to the seeded value; a system reset enrolls a new factor.
Recovery codes are not preallocated by this fixture. Run each test worker against
its own database so concurrent logins cannot consume the same account's code.

API-key helpers use the Node-side `api:request` task, with a separate cookie jar
for each API key and test-server base URL. Jars are cleared before each spec;
multi-request cart workflows retain their state without sharing browser cookies.
GET and HEAD requests omit legacy body arguments. Helpers return status, headers,
and parsed JSON (or text), preserve the configured
base URL's subdirectory, and expose redirects for assertions instead of following
them. Requests to another origin are rejected. UI requests that exercise the
logged-in user's permissions use `cy.request()` without an API-key header.

Run `cypress/e2e/ui/user/api-session-isolation.spec.js` on both URL layouts to
verify API-key calls preserve browser cookies and the browser user's permissions.
