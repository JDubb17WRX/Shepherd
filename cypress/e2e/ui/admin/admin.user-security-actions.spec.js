/// <reference types="cypress" />

const TARGET_USER_SECURITY_ACTION = "/admin/api/user/99/disableTwoFactor";

function requestWithCurrentSession(method, url, body, csrfToken = null) {
    const request = {
        method,
        url,
        failOnStatusCode: false,
        followRedirect: false,
        headers: { Accept: "application/json" },
    };
    if (csrfToken) request.headers["X-CSRF-Token"] = csrfToken;
    if (body !== undefined) request.body = body;

    return cy.request(request);
}

function expectReauthenticationRequired(response) {
    expect(response.status).to.eq(428);
    expect(response.body).to.have.property("code", "reauthentication_required");
    expect(response.headers["cache-control"]).to.include("no-store");
}

function expectInvalidCurrentPassword(response) {
    expect(response.status).to.eq(422);
    expect(response.body).to.have.property("code", "invalid_current_password");
}

describe("Admin User Security Actions", () => {
    it("requires browser CSRF and a recent local password confirmation", () => {
        let csrfToken;
        let sessionCookieBeforeMutation;

        cy.setupAdminSession({ forceLogin: true });
        cy.visit("/admin/system/users");
        cy.get("#admin-user-security-context")
            .invoke("attr", "data-csrf-token")
            .then((token) => {
                expect(token).to.match(/^[a-f0-9]{64}$/);
                csrfToken = token;
            })
            .then(() => requestWithCurrentSession("POST", TARGET_USER_SECURITY_ACTION, undefined))
            .its("status")
            .should("eq", 403)
            .then(() => requestWithCurrentSession("POST", "/admin/api/user/99/login/reset", undefined))
            .its("status")
            .should("eq", 403)
            .then(() => requestWithCurrentSession(
                "POST",
                "/api/user/current/reauthenticate",
                { currentPassword: `${Cypress.env("admin.password")}-incorrect` },
                csrfToken,
            ))
            .then(expectInvalidCurrentPassword)
            .then(() => requestWithCurrentSession("POST", TARGET_USER_SECURITY_ACTION, undefined, csrfToken))
            .then(expectReauthenticationRequired)
            .then(() => requestWithCurrentSession("POST", "/admin/api/user/99/login/reset", undefined, csrfToken))
            .then(expectReauthenticationRequired)
            .then(() => requestWithCurrentSession(
                "POST",
                "/api/user/current/reauthenticate",
                { currentPassword: Cypress.env("admin.password") },
                csrfToken,
            ))
            .then((response) => {
                expect(response.status).to.eq(200);
                expect(response.body.CSRFToken).to.eq(csrfToken);
                csrfToken = response.body.CSRFToken;
            })
            .then(() => cy.getCookies())
            .then((cookies) => {
                const sessionCookie = cookies.find((cookie) => cookie.name.startsWith("CRM-"));
                expect(sessionCookie, "authenticated CRM session cookie").to.exist;
                sessionCookieBeforeMutation = sessionCookie.value;
            })
            .then(() => requestWithCurrentSession("POST", "/admin/api/user/99/login/reset", undefined, csrfToken))
            .its("status")
            .should("eq", 200)
            .then(() => cy.getCookies())
            .then((cookies) => {
                const sessionCookie = cookies.find((cookie) => cookie.name.startsWith("CRM-"));
                expect(sessionCookie, "rotated CRM session cookie after login reset").to.exist;
                expect(sessionCookie.value).not.to.eq(sessionCookieBeforeMutation);
                sessionCookieBeforeMutation = sessionCookie.value;
            })
            .then(() => requestWithCurrentSession("POST", TARGET_USER_SECURITY_ACTION, undefined, csrfToken))
            .its("status")
            .should("eq", 200)
            .then(() => cy.getCookies())
            .then((cookies) => {
                const sessionCookie = cookies.find((cookie) => cookie.name.startsWith("CRM-"));
                expect(sessionCookie, "rotated CRM session cookie after disabling 2FA").to.exist;
                expect(sessionCookie.value).not.to.eq(sessionCookieBeforeMutation);
            });
    });
});
