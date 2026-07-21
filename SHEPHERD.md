# Shepherd

Shepherd is the Elkins Park Reformed Presbyterian Church management portal. It is a branded fork of [ChurchCRM 7.5.0](https://github.com/ChurchCRM/CRM/tree/7.5.0), licensed under the MIT License. The upstream `LICENSE` file and attribution are intentionally retained.

## Upstream baseline and updates

- Baseline: tag `7.5.0`, commit `6cdf3252f7af3c11015d16536c65c719fa5b21ed`.
- Included post-release security patch: upstream commit `f310c2e06`.
- Keep Shepherd-specific code in `ChurchCRM/Shepherd`, the Shepherd route/view files, branding files, and `docker/shepherd` where practical.
- For an upstream update, create a temporary branch from the desired signed/released tag, merge or cherry-pick Shepherd commits, run the full upstream build/test suite, review security headers and self-service authorization, then deploy to a staging database restored from a production backup.

## Production assumptions

The application is served only at `/shepherd/` behind the same-origin Elkins Park Nginx gateway. FrankenPHP listens internally on port 8080. MariaDB is not exposed publicly. X-Frame-Options and CSP allow framing only by the same origin.

Required secrets are injected through the website compose `.env`: database passwords and `SHEPHERD_AUDIT_KEY` (a random value of at least 32 bytes). SMTP settings are optional at container startup but are required before account requests can deliver verification and password-setup mail.

Back up both the MariaDB volume and the persistent `Images`, `uploads`, `SQL`, `logs`, and `tmp_attach` volumes before upgrades. Test restoration regularly. A new installation uses ChurchCRM's setup flow to create its initial administrator; administrators must enroll in 2FA before using the application.
