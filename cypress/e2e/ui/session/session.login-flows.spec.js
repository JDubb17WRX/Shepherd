/// <reference types="cypress" />

/**
 * Login redirect flows for the dedicated seed users (see cypress/data/seed.sql):
 *   - twofa_user      — usr_TwoFactorAuthSecret set  → 2FA challenge
 *   - mustchange.user — usr_NeedPasswordChange = 1    → forced password change
 *   - locked.user     — usr_FailedLogins = 99         → rejected, stays on login
 *
 * All three use password "changeme".
 */
function login(userName, password) {
    cy.clearCookies();
    cy.visit("/session/begin");
    cy.get("input[name=User]").type(userName);
    cy.get("input[name=Password]").type(`${password}{enter}`);
}

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

function submitCurrentTotp() {
    cy.task("generateTotp", { secret: "JBSWY3DPEBLW64TMMQ======" }, { log: false })
        .then((code) => {
            cy.get("#TwoFACode").clear().type(code);
            cy.get('form[name="TwoFAForm"]').submit();
        });
}

function submitInvalidTotp() {
    cy.get("#TwoFACode").clear().type("abcdef");
    cy.get('form[name="TwoFAForm"]').submit();
}

describe("Session Login Flows", () => {
    describe("2FA-enabled user (twofa_user)", () => {
        beforeEach(() => {
            cy.makePrivateAdminAPICall("POST", "/admin/api/user/27/login/reset", null, 200);
            cy.task("resetTwoFactorReplay", { username: "twofa_user" }).should("eq", 1);
        });

        afterEach(() => {
            cy.makePrivateAdminAPICall("POST", "/admin/api/user/27/login/reset", null, 200);
            cy.task("resetTwoFactorReplay", { username: "twofa_user" }).should("eq", 1);
        });

        it("Valid password redirects to the 2FA challenge", () => {
            login("twofa_user", "changeme");
            cy.url({ timeout: 10000 }).should("include", "/session/two-factor");
            cy.get("#TwoFACode").should("exist");
        });

        it("Password-only session cannot call private or 2FA recovery/removal APIs", () => {
            login("twofa_user", "changeme");
            cy.url({ timeout: 10000 }).should("include", "/session/two-factor");
            cy.visit("/v2/dashboard");
            cy.url({ timeout: 10000 }).should("include", "/session/two-factor");

            const blockedRequests = [
                { method: "GET", url: "/api/persons/roles" },
                { method: "POST", url: "/api/user/current/refresh2farecoverycodes" },
                { method: "POST", url: "/api/user/current/remove2fasecret" },
            ];
            cy.wrap(blockedRequests).each(({ method, url }) => {
                requestWithCurrentSession(method, url).then((response) => {
                    expect(response.status, `${method} ${url}`).to.eq(401);
                    expect(response.body).to.have.property("code", 401);
                });
            });

            cy.get("#TwoFACode").should("exist");
        });

        it("Rejects the pending second factor if the account becomes locked", () => {
            login("twofa_user", "changeme");
            cy.url({ timeout: 10000 }).should("include", "/session/two-factor");

            for (let attempt = 0; attempt < 5; attempt += 1) {
                requestWithCurrentSession("POST", "/api/public/user/login", {
                    userName: "twofa_user",
                    password: "wrong_password",
                }).its("status").should("eq", 401);
            }

            submitCurrentTotp();
            cy.url({ timeout: 10000 }).should("include", "/session/begin");
            requestWithCurrentSession("GET", "/api/persons/roles").its("status").should("eq", 401);
        });

        it("Valid TOTP completes login and unlocks the private API", () => {
            login("twofa_user", "changeme");
            cy.url({ timeout: 10000 }).should("include", "/session/two-factor");

            submitCurrentTotp();

            cy.url({ timeout: 10000 }).should("not.include", "/session/two-factor");
            requestWithCurrentSession("GET", "/api/persons/roles").its("status").should("eq", 200);
        });

        it("Rate-limits invalid TOTP attempts across fresh password sessions", () => {
            for (let attempt = 1; attempt <= 10; attempt += 1) {
                login("twofa_user", "changeme");
                cy.url({ timeout: 10000 }).should("include", "/session/two-factor");
                submitInvalidTotp();

                if (attempt < 10) {
                    cy.url({ timeout: 10000 }).should("include", "/session/two-factor?invalid=1");
                } else {
                    cy.url({ timeout: 10000 }).should("include", "/session/begin");
                }
            }

            // A new successful password submission cannot reset the shared
            // counter or mint another second-factor guessing session.
            login("twofa_user", "changeme");
            cy.url({ timeout: 10000 }).should("include", "/session/begin");
            cy.get("#TwoFACode").should("not.exist");
            requestWithCurrentSession("GET", "/api/persons/roles").its("status").should("eq", 401);
        });
    });

    describe("API-token request isolation", () => {
        it("Does not reuse API-key identity on a later token-less request", () => {
            cy.clearCookies();
            cy.request({
                method: "GET",
                url: "/api/persons/roles",
                headers: { "x-api-key": Cypress.env("admin.api.key") },
            })
                .its("status")
                .should("eq", 200);

            requestWithCurrentSession("GET", "/api/persons/roles").its("status").should("eq", 401);
        });

        it("Rejects API keys for accounts with incomplete security steps", () => {
            const blockedKeys = [
                "unenrolledAdminApiKeyForTesting123456789",
                "mustChangeApiKeyForTesting123456789012345",
            ];

            cy.wrap(blockedKeys).each((apiKey) => {
                cy.request({
                    method: "GET",
                    url: "/api/persons/roles",
                    headers: { "x-api-key": apiKey },
                    failOnStatusCode: false,
                }).its("status").should("eq", 401);
            });
        });
    });

    describe("Password-change-required user (mustchange.user)", () => {
        it("Login redirects to the change-password page", () => {
            login("mustchange.user", "changeme");
            cy.url({ timeout: 10000 }).should("include", "/v2/user/current/changepassword");
            cy.get("#OldPassword").should("exist");

            cy.get("#OldPassword").type("wrong_password");
            cy.get("#NewPassword1").type("ThisWillNotBeSaved123!");
            cy.get("#NewPassword2").type("ThisWillNotBeSaved123!");
            cy.get("#passwordChangeForm").submit();
            cy.url({ timeout: 10000 }).should("include", "/v2/user/current/changepassword");
            cy.get(".form-field-error").should("contain", "Incorrect password supplied for current user");
            cy.get("#OldPassword").should("exist");
            requestWithCurrentSession("GET", "/api/persons/roles").its("status").should("eq", 403);
        });
    });

    describe("Locked account (locked.user)", () => {
        it("Correct password is rejected and stays on the login page", () => {
            // Locked from the first attempt (seeded over iMaxFailedLogins): no session
            // is granted, so the user never reaches the dashboard or any next step.
            login("locked.user", "changeme");
            cy.url({ timeout: 10000 }).should("include", "/session/begin");
            cy.get("input[name=User]").should("exist");
        });
    });

    describe("Existing session after account lock", () => {
        beforeEach(() => {
            cy.makePrivateAdminAPICall("POST", "/admin/api/user/4/login/reset", null, 200);
        });

        afterEach(() => {
            cy.makePrivateAdminAPICall("POST", "/admin/api/user/4/login/reset", null, 200);
        });

        it("Invalidates a fully authenticated session when the account is locked", () => {
            login("limited.user", "changeme");
            cy.url({ timeout: 10000 }).should("not.include", "/session/begin");

            for (let attempt = 0; attempt < 5; attempt += 1) {
                requestWithCurrentSession("POST", "/api/public/user/login", {
                    userName: "limited.user",
                    password: "wrong_password",
                }).its("status").should("eq", 401);
            }

            requestWithCurrentSession("GET", "/api/persons/roles").its("status").should("eq", 401);
            cy.visit("/v2/dashboard");
            cy.url({ timeout: 10000 }).should("include", "/session/begin");
        });
    });

    describe("Failed primary authentication with session timeout disabled", () => {
        beforeEach(() => {
            cy.makePrivateAdminAPICall("POST", "/admin/api/system/config/iSessionTimeout", { value: "3600" }, 200);
            cy.makePrivateAdminAPICall("POST", "/admin/api/user/900/login/reset", null, 200);
            cy.makePrivateAdminAPICall("POST", "/admin/api/system/config/iSessionTimeout", { value: "0" }, 200);
        });

        afterEach(() => {
            cy.makePrivateAdminAPICall("POST", "/admin/api/system/config/iSessionTimeout", { value: "3600" }, 200);
            cy.makePrivateAdminAPICall("POST", "/admin/api/user/900/login/reset", null, 200);
        });

        it("Wrong password does not leave an authenticated user in the session", () => {
            login("john.plainauth@example.com", "wrong_password");
            cy.url({ timeout: 10000 }).should("include", "/session/begin");
            cy.visit("/v2/dashboard");
            cy.url({ timeout: 10000 }).should("include", "/session/begin");
            requestWithCurrentSession("GET", "/api/persons/roles").its("status").should("eq", 401);
        });

        it("Locked account does not leave an authenticated user in the session", () => {
            login("locked.user", "changeme");
            cy.url({ timeout: 10000 }).should("include", "/session/begin");
            cy.visit("/v2/dashboard");
            cy.url({ timeout: 10000 }).should("include", "/session/begin");
            requestWithCurrentSession("GET", "/api/persons/roles").its("status").should("eq", 401);
        });
    });

    describe("Mandatory 2FA enrollment", () => {
        beforeEach(() => {
            cy.makePrivateAdminAPICall("POST", "/admin/api/system/config/bRequire2FA", { value: "0" }, 200);
            cy.makePrivateAdminAPICall("POST", "/admin/api/user/900/disableTwoFactor", null, 200);
            cy.makePrivateAdminAPICall("POST", "/admin/api/system/config/bRequire2FA", { value: "1" }, 200);
        });

        afterEach(() => {
            cy.makePrivateAdminAPICall("POST", "/admin/api/system/config/bRequire2FA", { value: "0" }, 200);
            cy.makePrivateAdminAPICall("POST", "/admin/api/user/900/disableTwoFactor", null, 200);
        });

        it("Blocks ordinary APIs while allowing enrollment completion endpoints", () => {
            cy.request({
                method: "GET",
                url: "/api/persons/roles",
                headers: { "x-api-key": Cypress.env("plainauth.api.key") },
                failOnStatusCode: false,
            }).its("status").should("eq", 401);

            login("john.plainauth@example.com", "changeme");
            cy.url({ timeout: 10000 }).should("include", "/v2/user/current/manage2fa");

            requestWithCurrentSession("GET", "/api/persons/roles").its("status").should("eq", 403);
            requestWithCurrentSession("GET", "/api/user/current/2fa-status").its("status").should("eq", 200);
            requestWithCurrentSession("POST", "/api/user/current/refresh2fasecret").its("status").should("eq", 403);

            cy.get("#two-factor-enrollment-app")
                .invoke("attr", "data-csrf-token")
                .then((csrfToken) => {
                    expect(csrfToken).to.match(/^[a-f0-9]{64}$/);
                    requestWithCurrentSession(
                        "POST",
                        "/api/user/current/refresh2fasecret",
                        undefined,
                        csrfToken,
                    ).then((response) => {
                        expect(response.status).to.eq(200);
                        expect(response.headers["cache-control"]).to.include("no-store");
                    });
                    requestWithCurrentSession("POST", "/api/user/current/test2FAEnrollmentCode", {
                        enrollmentCode: "000000",
                    }, csrfToken).then((response) => {
                        expect(response.status).to.eq(200);
                        expect(response.body).to.have.property("IsEnrollmentCodeValid");
                    });
            });
        });
    });
});
