# Shepherd runtime contracts

Run `npm run test:shepherd:contracts` before pushing. This command uses only
Node's built-in test runner and reads checked-in files; it needs no dependency
installation, PHP, Docker, database, or credentials.

The current nine tests cover private person/family media, protected uploads and
backups, module routing and direct-view denial, the generic FrankenPHP routing
example, integrity-check handling, and readiness/liveness separation.

The local pre-push hook and the existing Shepherd image workflow run the same
command before pushing or building an image, respectively.

These static configuration checks complement the image workflow's PHP, database,
authentication, migration, and HTTP integration tests. They do not replace those
tests or establish that the full Cypress suite passes.
