/// <reference types="cypress" />

describe("API Public User", () => {
    // Basic authentication tests
    describe("Login - Basic Authentication", () => {
        beforeEach(() => {
            cy.makePrivateAdminAPICall("POST", "/admin/api/user/1/login/reset", null, 200);
        });

        afterEach(() => {
            cy.makePrivateAdminAPICall("POST", "/admin/api/user/1/login/reset", null, 200);
        });

        it("Login with valid credentials returns apiKey", () => {
            const user = {
                userName: "tony.wade@example.com",
                password: "basicjoe",
            };

            cy.apiRequest({
                method: "POST",
                url: "/api/public/user/login",
                headers: { "content-type": "application/json" },
                body: user,
            }).then((resp) => {
                expect(resp.status).to.eq(200);
                expect(resp.body).to.have.property('apiKey');
                expect(resp.body.apiKey).to.eq(Cypress.env("user.api.key"));
            });
        });

        it("Does not issue API keys while required account security steps are incomplete", () => {
            const blockedUsers = [
                { userName: "unenrolled.admin", password: "changeme", label: "admin without 2FA enrollment" },
                { userName: "mustchange.user", password: "changeme", label: "forced password change" },
            ];

            cy.wrap(blockedUsers).each((blockedUser) => {
                cy.apiRequest({
                    method: "POST",
                    url: "/api/public/user/login",
                    headers: { "content-type": "application/json" },
                    body: { userName: blockedUser.userName, password: blockedUser.password },
                    failOnStatusCode: false,
                }).then((resp) => {
                    expect(resp.status, blockedUser.label).to.eq(401);
                    expect(resp.body.error, blockedUser.label).to.eq("Invalid login or password");
                });
            });
        });

        it("Login with non-existent user returns 401 (not 404)", () => {
            cy.apiRequest({
                method: "POST",
                url: "/api/public/user/login",
                headers: { "content-type": "application/json" },
                body: { userName: "nonexistent_user_xyz", password: "anything" },
                failOnStatusCode: false,
            }).then((resp) => {
                // Should return 401 (same as wrong password) to prevent username enumeration
                expect(resp.status).to.eq(401);
            });
        });

        it("Login with wrong password returns 401", () => {
            cy.apiRequest({
                method: "POST",
                url: "/api/public/user/login",
                headers: { "content-type": "application/json" },
                body: { userName: "admin", password: "wrong_password" },
                failOnStatusCode: false,
            }).then((resp) => {
                expect(resp.status).to.eq(401);
            });
        });

        it("Login with empty userName returns 401", () => {
            cy.apiRequest({
                method: "POST",
                url: "/api/public/user/login",
                headers: { "content-type": "application/json" },
                body: { userName: "", password: "anything" },
                failOnStatusCode: false,
            }).then((resp) => {
                expect(resp.status).to.eq(401);
            });
        });

        it("Error message is generic to prevent user enumeration", () => {
            const GENERIC_ERROR = "Invalid login or password";
            const testCases = [
                { userName: "nonexistent", password: "wrong", label: "non-existent user" },
                { userName: "admin", password: "wrong", label: "wrong password" },
                { userName: "", password: "wrong", label: "empty username" },
            ];

            cy.wrap(testCases).each((testCase) => {
                cy.apiRequest({
                    method: "POST",
                    url: "/api/public/user/login",
                    headers: { "content-type": "application/json" },
                    body: { userName: testCase.userName, password: testCase.password },
                    failOnStatusCode: false,
                }).then((resp) => {
                    expect(resp.status, testCase.label).to.eq(401);
                    expect(resp.body.error, testCase.label).to.eq(GENERIC_ERROR);
                });
            });
        });
    });

    // 2FA Authentication tests
    // Uses the seeded `twofa_user` (password "changeme", usr_TwoFactorAuthSecret
    // is a Defuse-encrypted TOTP secret that decrypts to JBSWY3DPEBLW64TMMQ======).
    describe("2FA Authentication", () => {
        beforeEach(() => {
            cy.makePrivateAdminAPICall("POST", "/admin/api/user/27/login/reset", null, 200);
            cy.task("resetTwoFactorReplay", { username: "twofa_user" }).should("eq", 1);
        });

        afterEach(() => {
            cy.makePrivateAdminAPICall("POST", "/admin/api/user/27/login/reset", null, 200);
            cy.task("resetTwoFactorReplay", { username: "twofa_user" }).should("eq", 1);
        });

        it("Login returns 202 requiresOTP when valid password supplied but OTP omitted", () => {
            cy.apiRequest({
                method: "POST",
                url: "/api/public/user/login",
                headers: { "content-type": "application/json" },
                body: { userName: "twofa_user", password: "changeme" },
                failOnStatusCode: false,
            }).then((resp) => {
                expect(resp.status).to.eq(202);
                expect(resp.body).to.have.property("requiresOTP", true);
            });
        });

        it("Login returns 401 on invalid OTP", () => {
            cy.apiRequest({
                method: "POST",
                url: "/api/public/user/login",
                headers: { "content-type": "application/json" },
                body: { userName: "twofa_user", password: "changeme", otp: "000000" },
                failOnStatusCode: false,
            }).then((resp) => {
                expect(resp.status).to.eq(401);
                expect(resp.body.error).to.eq("Invalid login or password");
            });
        });

        it("Accepts a valid TOTP and clears earlier factor failures", () => {
            for (let attempt = 0; attempt < 2; attempt += 1) {
                cy.apiRequest({
                    method: "POST",
                    url: "/api/public/user/login",
                    headers: { "content-type": "application/json" },
                    body: { userName: "twofa_user", password: "changeme", otp: "invalid" },
                    failOnStatusCode: false,
                }).its("status").should("eq", 401);
            }

            cy.task("generateTotp", { secret: "JBSWY3DPEBLW64TMMQ======" }, { log: false })
                .then((otp) => {
                    cy.apiRequest({
                        method: "POST",
                        url: "/api/public/user/login",
                        headers: { "content-type": "application/json" },
                        body: { userName: "twofa_user", password: "changeme", otp },
                    }).its("status").should("eq", 200);
                });

            // A successful full authentication removes the previous failure
            // window. Nine new failures must therefore remain below the limit.
            for (let attempt = 0; attempt < 9; attempt += 1) {
                cy.apiRequest({
                    method: "POST",
                    url: "/api/public/user/login",
                    headers: { "content-type": "application/json" },
                    body: { userName: "twofa_user", password: "changeme", otp: "invalid" },
                    failOnStatusCode: false,
                }).its("status").should("eq", 401);
            }
            cy.apiRequest({
                method: "POST",
                url: "/api/public/user/login",
                headers: { "content-type": "application/json" },
                body: { userName: "twofa_user", password: "changeme" },
                failOnStatusCode: false,
            }).its("status").should("eq", 202);
        });

        it("Rate-limits invalid OTP attempts made through the public API", () => {
            for (let attempt = 0; attempt < 10; attempt += 1) {
                cy.apiRequest({
                    method: "POST",
                    url: "/api/public/user/login",
                    headers: { "content-type": "application/json" },
                    body: { userName: "twofa_user", password: "changeme", otp: "abcdef" },
                    failOnStatusCode: false,
                }).its("status").should("eq", 401);
            }

            cy.apiRequest({
                method: "POST",
                url: "/api/public/user/login",
                headers: { "content-type": "application/json" },
                body: { userName: "twofa_user", password: "changeme" },
                failOnStatusCode: false,
            }).its("status").should("eq", 401);
        });
    });

    // Lockout tests
    // Uses `limited.user` (seeded, password "changeme") so admin credentials are not affected.
    describe("Account Lockout", () => {
        const LOCKOUT_USER = "limited.user";
        const LOCKOUT_PASS = "changeme";
        const MAX_FAILURES = 5; // matches iMaxFailedLogins default in SystemConfig

        beforeEach(() => {
            cy.makePrivateAdminAPICall("POST", "/admin/api/user/4/login/reset", null, 200);
        });

        afterEach(() => {
            cy.makePrivateAdminAPICall("POST", "/admin/api/user/4/login/reset", null, 200);
        });

        it("Correct password still returns 401 after account is locked", () => {
            // Trigger lockout by exhausting failed login attempts
            for (let i = 0; i < MAX_FAILURES; i++) {
                cy.apiRequest({
                    method: "POST",
                    url: "/api/public/user/login",
                    headers: { "content-type": "application/json" },
                    body: { userName: LOCKOUT_USER, password: "wrong_password" },
                    failOnStatusCode: false,
                });
            }

            // Correct password should now be rejected (account locked)
            cy.apiRequest({
                method: "POST",
                url: "/api/public/user/login",
                headers: { "content-type": "application/json" },
                body: { userName: LOCKOUT_USER, password: LOCKOUT_PASS },
                failOnStatusCode: false,
            }).then((resp) => {
                expect(resp.status).to.eq(401);
                // Same generic message as wrong password — prevents confirming lockout state
                expect(resp.body.error).to.eq("Invalid login or password");
            });

            cy.request({
                method: "GET",
                url: "/api/persons/roles",
                headers: { "x-api-key": Cypress.env("limited.api.key") },
                failOnStatusCode: false,
            }).its("status").should("eq", 401);
        });

        it("Counts parallel password failures without losing increments", () => {
            cy.visit("/session/begin");
            cy.window()
                .then((win) => {
                    const baseUrl = Cypress.config("baseUrl");
                    const endpoint = new URL(
                        "api/public/user/login",
                        baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`,
                    ).toString();
                    const request = () =>
                        win.fetch(endpoint, {
                            method: "POST",
                            credentials: "omit",
                            headers: { "content-type": "application/json" },
                            body: JSON.stringify({ userName: LOCKOUT_USER, password: "wrong_password" }),
                        });

                    return Promise.all(Array.from({ length: MAX_FAILURES }, request));
                })
                .then((responses) => {
                    for (const response of responses) expect(response.status).to.eq(401);
                });

            cy.apiRequest({
                method: "POST",
                url: "/api/public/user/login",
                headers: { "content-type": "application/json" },
                body: { userName: LOCKOUT_USER, password: LOCKOUT_PASS },
                failOnStatusCode: false,
            }).its("status").should("eq", 401);
        });

        it("Correct password returns 401 for a pre-locked seeded account", () => {
            // `locked.user` is seeded with usr_FailedLogins = 99 (well over
            // iMaxFailedLogins), so it is locked from the first request — no need
            // to exhaust attempts. Correct credentials must still return the
            // generic 401 so lockout state can't be probed.
            cy.apiRequest({
                method: "POST",
                url: "/api/public/user/login",
                headers: { "content-type": "application/json" },
                body: { userName: "locked.user", password: "changeme" },
                failOnStatusCode: false,
            }).then((resp) => {
                expect(resp.status).to.eq(401);
                expect(resp.body.error).to.eq("Invalid login or password");
            });
        });
    });

    // Password Reset tests
    describe("Password Reset", () => {
        it("Successful password reset request with valid user", () => {
            cy.apiRequest({
                method: "POST",
                url: "/api/public/user/password-reset",
                headers: { "content-type": "application/json" },
                body: { userName: "admin" },
            }).then((resp) => {
                expect(resp.status).to.eq(200);
                expect(resp.body).to.have.property('success');
                expect(resp.body.success).to.eq(true);
            });
        });

        it("Password reset request with non-existent user returns success (security)", () => {
            cy.apiRequest({
                method: "POST",
                url: "/api/public/user/password-reset",
                headers: { "content-type": "application/json" },
                body: { userName: "nonexistentuser123" },
            }).then((resp) => {
                expect(resp.status).to.eq(200);
                expect(resp.body).to.have.property('success');
                expect(resp.body.success).to.eq(true);
            });
        });

        it("Password reset request is case-insensitive", () => {
            cy.apiRequest({
                method: "POST",
                url: "/api/public/user/password-reset",
                headers: { "content-type": "application/json" },
                body: { userName: "ADMIN" },
            }).then((resp) => {
                expect(resp.status).to.eq(200);
                expect(resp.body.success).to.eq(true);
            });
        });
    });
});
