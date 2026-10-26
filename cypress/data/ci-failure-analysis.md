# PR 18 failure analysis — October 26, 2026

Examined commit `5fff450f010256ec31125e77bbeb9a13515868d9`,
[Actions run 40008355339](https://github.com/JDubb17WRX/Shepherd/actions/runs/40008355339).
No Cypress runs or CI reruns were started during this investigation.

Build, Typecheck & Lint, security scanning, both fresh-install jobs, and UI shard 0
on both URL layouts passed. The root/subdirectory API jobs failed. The remaining
UI jobs exceeded their 40-minute execution limit and had recorded test failures;
their cancellation was not a fail-fast response to the API jobs.

## Prepared local corrections

1. **The API suite deletes its own shared administrator.**
   `private.admin.user.self-delete.spec.js` runs as spec 46 of 161. Its DELETE
   receives 200 instead of 403. `src/admin/routes/api/user-admin.php` has no
   self-deletion guard before `$user->delete()`. The following admin-settings
   spec fails, followed by the authentication fixture and many unrelated specs
   returning 401. Refuse deletion when the target and authenticated person IDs
   match, using the canonical JSON error. The existing regression checks the
   refusal and verifies that the account remains available.

2. **The new transport forwards legacy GET bodies to fetch.**
   Sixteen reported errors contain `Request with GET/HEAD method cannot have
   body`. Existing callers pass `""` and objects as body placeholders. The
   transport now normalizes the method and omits GET/HEAD bodies. This matches
   [Undici's request validation](https://github.com/nodejs/undici/blob/main/lib/web/fetch/request.js).

3. **Stateless transport discards application session data.**
   Cart contents live in `$_SESSION['aPeopleCart']` in `Cart.php`. A fresh cookie
   on every request cannot retain the cart across POST/GET/emptyToGroup calls.
   The patch keeps a Node-side cookie jar per API key and test-server base URL,
   clearing jars before each spec. Browser cookies remain separate. Regression
   cases cover API cart persistence, isolation between keys, and isolation from
   the browser cart. [Cypress's cookie behavior](https://docs.cypress.io/api/commands/request#cookies)
   explains why using its browser cookie jar for these API calls is unsuitable.

4. **Public-auth tests expect the earlier upstream policy.**
   An enrolled administrator without an OTP correctly receives 202 rather than
   an API key. The password-only success case now uses the standard user, and a
   separate case asserts the administrator's challenge. The factor limiter is
   ten attempts per window (`User::MAX_TWO_FACTOR_FAILURES`), separate from the
   five-failure password lockout; the OTP test now checks that limiter.
   `EnvironmentBootstrap::apply()` forces public self-registration off, so the
   anonymous registration API cases now require 403.

## Remaining UI and security work

- **Migrate direct administrator logins.** `admin.ministry-settings.spec.js`,
  the `admin.volunteer-v2.*` specs, `volunteer-v2.coordinator.spec.js`,
  `volunteer-v2.e2e.spec.js`, and portal helpers submit only the password and
  continue from `/session/two-factor`. Use the shared 2FA-aware login helpers;
  reuse validated sessions for ordinary UI setup. Repeated forced logins also
  pay the fixture's next-TOTP-window wait and contribute to the timeout.
- **Use fixtures compatible with disabled public registration.** Guest/mobile
  registration tests expect the disabled registration form. Self-registration
  review, pending-directory, and proposed-member specs use the disabled public
  registration API for setup and receive 403. Preserve meaningful review and
  portal coverage by creating fixtures through supported authenticated/member
  workflows. Test the public surface as disabled; do not enable it in production
  or skip failed tests to obtain a pass.
- **Retain security assertions and repair their implementations.** The empty
  password spec demonstrates that an existing blank/whitespace password hash can
  authenticate. `User::verifyPasswordHash()` needs to reject blank and Unicode
  whitespace-only input; password creation and admin change validation need the
  same rule. The blocked-person browser tests also expose
  `LocalAuthentication` reporting a deceased/inactive account as password-locked;
  preserve the generic invalid-credentials response for those accounts.
- **Match 2FA UI fixtures to enrollment state.** The admin portal wizard test
  expects the intro screen although the admin is enrolled. The recovery-code
  test invokes a browser security action through an API key for an unenrolled
  user. Use an appropriate enrolled browser persona with recent authentication
  or an unenrolled dedicated persona for the actual enrollment workflow.
- **Review independent branding and grace-period expectations.** The church-logo
  test expects upstream bundled symbols while Shepherd uses its own branding.
  The grace-period spec expects an unenrolled user to bypass the current
  required-enrollment flow. Align assertions with the intended Shepherd policy
  without weakening enrollment enforcement.

The prepared patch addresses the API cascade and transport regressions. It does
not establish that the remaining UI jobs will pass. Complete those migrations
before treating a new full matrix run as final validation.

Static validation of the prepared changes passes: `npm run lint`,
`npm run build:php:validate`, JavaScript syntax checks, TypeScript configuration
transpilation, command declarations, API-key consistency, spec coverage, and diff
whitespace checks. The new/updated Cypress assertions have not been executed.
