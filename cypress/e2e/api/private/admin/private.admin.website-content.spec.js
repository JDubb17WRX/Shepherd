/// <reference types="cypress" />

describe('Administrator website content API', () => {
    const pageKey = 'services';
    const publicUrl = `/api/public/website-content/${pageKey}`;
    const sessionUrl = '/api/background/website-content/session';
    const updateUrl = `/api/website-content/${pageKey}`;

    function expectNoStore(response) {
        expect(response.headers['cache-control']).to.include('no-store');
        expect(response.headers.pragma).to.eq('no-cache');
    }

    function resetDocument(csrfToken, document) {
        if (Object.keys(document.content).length === 0) return;
        cy.request({
            method: 'PUT',
            url: updateUrl,
            headers: { 'X-CSRF-Token': csrfToken },
            body: { revision: document.revision, content: {} },
        }).its('status').should('eq', 200);
    }

    beforeEach(() => {
        cy.clearCookies();
    });

    it('allows anonymous reads but rejects an anonymous editor-session probe', () => {
        cy.request(publicUrl).then((response) => {
            expect(response.status).to.eq(200);
            expect(response.body).to.include.keys('page', 'content', 'revision');
            expect(response.body.page).to.eq(pageKey);
            expectNoStore(response);
            expect(response.headers).not.to.have.property('set-cookie');
        });
        cy.request({ url: sessionUrl, failOnStatusCode: false }).then((response) => {
            expect(response.status).to.eq(401);
            expect(response.headers).not.to.have.property('set-cookie');
        });
        cy.request('/api/public/website-content/privacy').then((response) => {
            expect(response.status).to.eq(200);
            expect(response.body.page).to.eq('privacy');
        });
    });

    it('rejects non-administrators and administrator API keys', () => {
        cy.setupStandardSession({ forceLogin: true });
        cy.request({ url: sessionUrl, failOnStatusCode: false }).its('status').should('eq', 403);

        cy.clearCookies();
        cy.makePrivateAdminAPICall('GET', sessionUrl, null, 403);
        cy.makePrivateAdminAPICall('PUT', updateUrl, {
            revision: '0'.repeat(64),
            content: {},
        }, 403);
    });

    it('rejects an administrator who has not completed mandatory two-factor enrollment', () => {
        cy.visit('/login');
        cy.get('input[name=User]').type('unenrolled.admin');
        cy.get('input[name=Password]').type('changeme{enter}');
        cy.url({ timeout: 15000 }).should('include', '/v2/user/current/manage2fa');
        cy.request({ url: sessionUrl, failOnStatusCode: false }).then((response) => {
            expect(response.status).to.eq(403);
        });
    });

    it('rechecks the Shepherd session on every write', () => {
        cy.setupAdminSession({ forceLogin: true });
        cy.request(sessionUrl).then(({ body: session }) => {
            cy.request(publicUrl).then(({ body: document }) => {
                cy.request({ url: '/session/end', followRedirect: false }).then((logoutResponse) => {
                    expect(logoutResponse.status).to.eq(302);
                });
                cy.request({
                    method: 'PUT',
                    url: updateUrl,
                    headers: { 'X-CSRF-Token': session.CSRFToken },
                    body: { revision: document.revision, content: {} },
                    failOnStatusCode: false,
                }).its('status').should('eq', 401);
            });
        });
    });

    it('requires CSRF and persists a valid revisioned update', () => {
        cy.setupAdminSession({ forceLogin: true });
        cy.request(sessionUrl).then((sessionResponse) => {
            expect(sessionResponse.status).to.eq(200);
            expect(sessionResponse.body).to.include({ canEdit: true });
            expect(sessionResponse.body.CSRFToken).to.match(/^[a-f0-9]{64}$/);
            expectNoStore(sessionResponse);
            const csrfToken = sessionResponse.body.CSRFToken;

            cy.request(publicUrl).then((initialResponse) => {
                const initial = initialResponse.body;
                resetDocument(csrfToken, initial);
                cy.request(publicUrl).then((cleanResponse) => {
                    const clean = cleanResponse.body;
                    const content = {
                        'services.schedule.morning-worship.time': {
                            base: '11:00 AM',
                            value: '11:30 AM',
                        },
                    };

                    cy.request({
                        method: 'PUT',
                        url: updateUrl,
                        headers: { 'X-CSRF-Token': csrfToken },
                        body: { revision: clean.revision, content },
                    }).then((savedResponse) => {
                        expect(savedResponse.status).to.eq(200);
                        expect(savedResponse.body.content).to.deep.eq(content);
                        expect(savedResponse.body.revision).to.not.eq(clean.revision);
                        expectNoStore(savedResponse);

                        cy.request(publicUrl).then((publishedResponse) => {
                            expect(publishedResponse.body.content).to.deep.eq(content);
                            expect(publishedResponse.body.revision).to.eq(savedResponse.body.revision);
                            resetDocument(csrfToken, publishedResponse.body);
                        });
                    });
                });
            });
        });
    });

    it('rejects missing or invalid CSRF and stale revisions', () => {
        cy.setupAdminSession({ forceLogin: true });
        cy.request(sessionUrl).then(({ body: session }) => {
            cy.request(publicUrl).then(({ body: initial }) => {
                resetDocument(session.CSRFToken, initial);
                cy.request(publicUrl).then(({ body: clean }) => {
                    const requestBody = {
                        revision: clean.revision,
                        content: {
                            'services.schedule.morning-worship.time': {
                                base: '11:00 AM',
                                value: '11:15 AM',
                            },
                        },
                    };

                    cy.request({
                        method: 'PUT', url: updateUrl, body: requestBody, failOnStatusCode: false,
                    }).its('status').should('eq', 403);
                    cy.request({
                        method: 'PUT',
                        url: updateUrl,
                        headers: { 'X-CSRF-Token': '0'.repeat(64) },
                        body: requestBody,
                        failOnStatusCode: false,
                    }).its('status').should('eq', 403);

                    cy.request({
                        method: 'PUT',
                        url: updateUrl,
                        headers: { 'X-CSRF-Token': session.CSRFToken },
                        body: requestBody,
                    }).then((savedResponse) => {
                        cy.request({
                            method: 'PUT',
                            url: updateUrl,
                            headers: { 'X-CSRF-Token': session.CSRFToken },
                            body: requestBody,
                            failOnStatusCode: false,
                        }).then((conflictResponse) => {
                            expect(conflictResponse.status).to.eq(409);
                            expect(conflictResponse.body.code).to.eq('revision_conflict');
                        });
                        resetDocument(session.CSRFToken, savedResponse.body);
                    });
                });
            });
        });
    });

    it('rejects unrecognized pages and entry shapes', () => {
        cy.request({
            url: '/api/public/website-content/not-a-real-page',
            failOnStatusCode: false,
        }).its('status').should('eq', 400);

        cy.setupAdminSession({ forceLogin: true });
        cy.request(sessionUrl).then(({ body: session }) => {
            cy.request(publicUrl).then(({ body: document }) => {
                cy.request({
                    method: 'PUT',
                    url: updateUrl,
                    headers: { 'X-CSRF-Token': session.CSRFToken },
                    body: {
                        revision: document.revision,
                        content: {
                            invalid: { base: 'plain', value: 'text', extra: '<script>alert(1)</script>' },
                        },
                    },
                    failOnStatusCode: false,
                }).its('status').should('eq', 400);
            });
        });
    });
});
