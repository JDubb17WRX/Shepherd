/// <reference types="cypress" />

/**
 * The console identity endpoint that nginx calls as an `auth_request`
 * subrequest in front of the proxied bulletin console.
 *
 * Two properties carry the security weight, and each has a test below:
 *
 *   - it answers 2xx only for a completed local browser session, so an
 *     anonymous or API-key caller is refused before nginx ever reaches an
 *     upstream;
 *   - the username it returns is canonical, because the consumer matches it
 *     against a roles file that only ever contains canonical names. A name
 *     that will not canonicalise is refused rather than passed through.
 */
describe('Console session identity API', () => {
    const sessionUrl = '/api/background/console/session';
    const editorSessionUrl = '/api/background/website-content/session';

    // Identical to SHEPHERD_USERNAME in the website repo's src/lib/roles.ts.
    // If these two ever disagree the console denies everybody, so assert the
    // shape here rather than only the literal value.
    const CANONICAL_USERNAME = /^[a-z0-9._-]{3,50}$/;

    // The absent Set-Cookie is not incidental. LoadConfigs.php exempts an
    // anonymous GET to this path from session initialisation, so a signed-out
    // probe creates no server-side session at all — which is what makes this
    // safe to call on every request to a proxied path. If this assertion ever
    // fails, that exemption has been lost and the session store is growing.
    function expectNoIdentity(response) {
        expect(response.headers).not.to.have.property('x-shepherd-username');
        expect(response.headers).not.to.have.property('set-cookie');
    }

    function expectIdentity(response, username) {
        expect(response.status).to.eq(200);
        expect(response.headers['x-shepherd-username']).to.eq(username);
        expect(response.headers['x-shepherd-username']).to.match(CANONICAL_USERNAME);
        expect(response.body.username).to.eq(username);
        expect(response.headers['cache-control']).to.include('no-store');
        expect(response.headers.pragma).to.eq('no-cache');
        expect(response.headers).not.to.have.property('set-cookie');
    }

    beforeEach(() => {
        cy.clearCookies();
    });

    it('refuses an anonymous probe without emitting an identity', () => {
        cy.request({ url: sessionUrl, failOnStatusCode: false }).then((response) => {
            expect(response.status).to.eq(401);
            expectNoIdentity(response);
        });
    });

    it('returns the canonical username for an administrator browser session', () => {
        cy.setupAdminSession({ forceLogin: true });
        cy.request(sessionUrl).then((response) => {
            // The seed stores this account as `Admin`. Asserting the lowercase
            // form is what proves canonicalisation actually runs — §2.5 of the
            // rebuild handoff requires the dormant bootstrap `Admin` to resolve
            // through the same normalisation as everyone else.
            expectIdentity(response, 'admin');
        });
    });

    it('serves a non-administrator, unlike the Administrator-only editor endpoint', () => {
        // The whole reason this endpoint exists. `finance.nofundraiser` is not a
        // Shepherd Administrator, so the website-editor session endpoint refuses
        // it; the console must not, because Elders and Deacons are not
        // Administrators either. Both calls run against the same session so the
        // contrast is the endpoint and nothing else.
        cy.setupNoManageFundraisersSession({ forceLogin: true });

        cy.request({ url: editorSessionUrl, failOnStatusCode: false })
            .its('status').should('eq', 403);

        cy.request(sessionUrl).then((response) => {
            expectIdentity(response, 'finance.nofundraiser');
        });
    });

    it('refuses a username that will not canonicalise', () => {
        // `tony.wade@example.com` is a valid Shepherd login but cannot appear in
        // the roles file, which admits only [a-z0-9._-]. Emitting it would hand
        // nginx an identity that matches no role — fail closed instead, so the
        // refusal is visible here rather than as a silent denial downstream.
        cy.setupStandardSession({ forceLogin: true });
        cy.request({ url: sessionUrl, failOnStatusCode: false }).then((response) => {
            expect(response.status).to.eq(403);
            expectNoIdentity(response);
        });
    });

    it('refuses API-key authentication', () => {
        // An API key is not a browser session. If this passed, any holder of a
        // leaked key could assume a console identity without ever signing in.
        cy.makePrivateAdminAPICall('GET', sessionUrl, null, 403);
    });

    it('refuses an administrator who has not completed mandatory two-factor enrollment', () => {
        cy.visit('/login');
        cy.get('input[name=User]').type('unenrolled.admin');
        cy.get('input[name=Password]').type('changeme{enter}');
        cy.url({ timeout: 15000 }).should('include', '/v2/user/current/manage2fa');
        cy.request({ url: sessionUrl, failOnStatusCode: false }).then((response) => {
            expect(response.status).to.eq(403);
            expectNoIdentity(response);
        });
    });

    it('rechecks the session on every call rather than trusting the first answer', () => {
        cy.setupAdminSession({ forceLogin: true });
        cy.request(sessionUrl).its('status').should('eq', 200);

        cy.request({ url: '/session/end', followRedirect: false })
            .its('status').should('eq', 302);

        cy.request({ url: sessionUrl, failOnStatusCode: false }).then((response) => {
            expect(response.status).to.eq(401);
            expectNoIdentity(response);
        });
    });
});
