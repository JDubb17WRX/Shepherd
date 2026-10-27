/// <reference types="cypress" />

// Shepherd requires enrollment immediately whenever two-factor authentication is mandatory.

describe("2FA Grace Period — config API", () => {
    it("GET i2FAGracePeriodDays returns exactly 7 (the default)", () => {
        cy.makePrivateAdminAPICall(
            "GET",
            "/admin/api/system/config/i2FAGracePeriodDays",
            null,
            200,
        ).then((resp) => {
            expect(resp.body).to.have.property("value");
            const value = Number(resp.body.value);
            expect(value).to.satisfy(Number.isFinite, "must be a finite number");
            expect(value).to.equal(7);
        });
    });

    it("POST i2FAGracePeriodDays persists the new value", () => {
        cy.makePrivateAdminAPICall(
            "POST",
            "/admin/api/system/config/i2FAGracePeriodDays",
            { value: "14" },
            200,
        ).then((resp) => {
            expect(resp.body.value).to.eq("14");
        });

        // Verify persistence
        cy.makePrivateAdminAPICall(
            "GET",
            "/admin/api/system/config/i2FAGracePeriodDays",
            null,
            200,
        ).then((resp) => {
            expect(resp.body.value).to.eq("14");
        });

        // Restore default
        cy.makePrivateAdminAPICall(
            "POST",
            "/admin/api/system/config/i2FAGracePeriodDays",
            { value: "7" },
            200,
        );
    });

    it("POST i2FAGracePeriodDays accepts 0 (immediate enforcement)", () => {
        cy.makePrivateAdminAPICall(
            "POST",
            "/admin/api/system/config/i2FAGracePeriodDays",
            { value: "0" },
            200,
        ).then((resp) => {
            expect(resp.body.value).to.eq("0");
        });

        // Restore default
        cy.makePrivateAdminAPICall(
            "POST",
            "/admin/api/system/config/i2FAGracePeriodDays",
            { value: "7" },
            200,
        );
    });
});

describe("2FA Grace Period — enforcement", () => {
    before(() => {
        cy.rememberTestEnv(["standard.username", "standard.password"]);
    });

    // Helper: set bRequire2FA to 1 or 0
    function setRequire2FA(value) {
        return cy.makePrivateAdminAPICall(
            "POST",
            "/admin/api/system/config/bRequire2FA",
            { value: value ? "1" : "0" },
            200,
        );
    }

    // Helper: set i2FAGracePeriodDays
    function setGraceDays(days) {
        return cy.makePrivateAdminAPICall(
            "POST",
            "/admin/api/system/config/i2FAGracePeriodDays",
            { value: String(days) },
            200,
        );
    }

    // Helper: ensure the standard user (person ID 3, tony.wade) has 2FA disabled
    function disableUser2FA(userId = 3) {
        return cy.makePrivateAdminAPICall(
            "POST",
            `/admin/api/user/${userId}/disableTwoFactor`,
            null,
            200,
        );
    }

    afterEach(() => {
        // Always restore safe defaults so other tests are not affected
        setRequire2FA(false);
        setGraceDays(7);
        disableUser2FA(3);
    });

    it("grace=7, mandate on: unenrolled user must enroll before accessing the dashboard", () => {
        disableUser2FA(3);
        setRequire2FA(true);
        setGraceDays(7);

        cy.clearCookies();
        cy.visit("/session/begin");
        cy.get("input[name=User]").type(Cypress.testEnv("standard.username"));
        cy.get("input[name=Password]").type(Cypress.testEnv("standard.password") + "{enter}");

        cy.url({ timeout: 15000 }).should("include", "manage2fa");
        cy.visit("/v2/dashboard");
        cy.url().should("include", "manage2fa");
    });

    it("grace=0, mandate on: unenrolled user is immediately redirected to enrollment", () => {
        disableUser2FA(3);
        setRequire2FA(true);
        setGraceDays(0);

        cy.clearCookies();
        cy.visit("/session/begin");
        cy.get("input[name=User]").type(Cypress.testEnv("standard.username"));
        cy.get("input[name=Password]").type(Cypress.testEnv("standard.password") + "{enter}");

        // Immediate mode: no grace window, must redirect to manage2fa
        cy.url({ timeout: 15000 }).should("include", "manage2fa");
    });

    // TODO: add a test for the expired-grace block path once a supported API
    // endpoint exists for back-dating usr_TwoFactorAuthGracePeriodStart, or
    // once a Cypress DB fixture helper is available in the Docker environment.
    it.skip("grace=7, grace start 8 days ago: unenrolled user is blocked (requires direct DB access)", () => {
        // This test requires updating usr_TwoFactorAuthGracePeriodStart to a
        // date in the past, which needs direct database access not currently
        // available via the public API. Run manually in a Docker environment.
    });

    it("mandate off: no grace banner shown", () => {
        disableUser2FA(3);
        setRequire2FA(false);
        setGraceDays(7);

        cy.clearCookies();
        cy.visit("/session/begin");
        cy.get("input[name=User]").type(Cypress.testEnv("standard.username"));
        cy.get("input[name=Password]").type(Cypress.testEnv("standard.password") + "{enter}");

        cy.url({ timeout: 15000 }).should("not.include", "manage2fa");
        // Banner must NOT be present when mandate is off
        cy.get("#two-fa-grace-banner").should("not.exist");
    });
});
