# Authentication repair validation

Branch: `codex/cypress-auth-fixtures`. Local validation on October 23, 2026.

## Existing integration and fixture evidence

- Stored fixture ciphertext decrypts with the seed database's encryption key.
- TOTP generator matches six SHA-1 RFC 6238 vectors (six-digit truncation).
- API task passes ten local HTTP assertions: root/subdirectory resolution, status,
  cookie isolation across calls, JSON request body, redirects, origin restriction,
  and timeout.
- Changed JavaScript parses; five affected TypeScript configurations transpile.
- Cypress command declarations, database-access validation, and `git diff --check` pass.
- With separate seeded Docker databases, the root and `/churchcrm/` installations
  each passed the targeted admin API (2/2) and browser (6/6) specs.
- A fresh-install Docker project passed setup and first-run enrollment (18/18),
  RewriteBase (1/1), backup/restore (12/12), and reset (3/3).
- Demo import passed 22/23. The sole failure was a direct plugin-management POST
  missing the CSRF token required by the page. The test now clicks the page's
  Disable control and awaits its API response.
- Post-reset verification passed 2 tests, failed 2, and skipped 3 after its setup
  hook failed. The hook retained `Cypress@01!` in its local credentials after
  changing the password back to `changeme`. The credential update now runs in
  `.then()` after the password-change success assertion, after the earlier
  login callback has completed.

## Final static review

- `npm run lint` passes, with existing Biome warnings.
- The UI convention validator normalizes path separators so its exclusions and
  baseline keys work on Windows as well as Linux.
- Cypress command declarations, API-key consistency, spec coverage, and database
  access validators pass. JavaScript syntax and diff whitespace checks pass.
- Local TypeScript checkout line endings were restored to the LF content already
  stored in Git so Biome can check them. Those files have no content diff.
- No Cypress runs or manual CI reruns were started during the final review, as
  requested by the user.

## Remaining validation

Both fresh-install jobs passed in GitHub on commit `5fff450f0`, including the
subdirectory installation. This confirms the plugin CSRF and post-reset
credential fixes in that CI run. The broader API/UI matrix still has failures;
see [the October 26 investigation](ci-failure-analysis.md).

A future fresh-install run needs an empty new-system database;
the first spec enrolls a random factor which is held in the Cypress Node process
for subsequent specs. Run all six specs together without sharding:

```sh
npx cypress run --config-file cypress/configs/new-system.config.ts
```

The Windows bind mount made the setup integrity check take roughly 30–50 seconds,
so the three readiness assertions now allow 120 seconds.

Do not mark PR #16 checks green based on these local results. Rerun failed CI
checks only when their failure is confirmed to be caused by code and the
corresponding fix is on the PR branch.
