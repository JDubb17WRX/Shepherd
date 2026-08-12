/// <reference types="cypress" />

/**
 * CSS Regression: Authentication Pages
 *
 * Verifies that auth-page-specific CSS (scoped under body.page-auth)
 * renders correctly on login, password reset, and error pages.
 * Guards against regressions from the global→scoped CSS migration.
 */

describe("Auth Page CSS Regression", () => {
    describe("Login Page Styling", () => {
        beforeEach(() => {
            cy.visit("/session/begin");
        });

        it("Should have page-auth body class", () => {
            cy.get("body").should("have.class", "page-auth");
        });

        it("Should render login container and card with proper layout", () => {
            cy.get(".login-container").should("be.visible");
            cy.get(".login-card").should("be.visible");
        });

        it("Should render sign-in button with Shepherd brand styling", () => {
            cy.get(".btn-sign-in").should("be.visible")
                .and("have.css", "background-color", "rgb(45, 90, 39)")
                .and("have.css", "background-image", "none");
        });

        it("Should render form inputs inside login form", () => {
            cy.get("input[name='User']").should("be.visible");
            cy.get("input[name='Password']").should("be.visible");
        });

        it("Should display login card header with church name or logo", () => {
            cy.get(".login-card-header").should("be.visible");
        });
    });

    describe("Login Page — Shepherd account-request navigation", () => {
        it("Pill control remains visible while raw family registration is disabled", () => {
            cy.visit("/session/begin");
            cy.get(".login-tab-control").should("be.visible");
            cy.get(".login-tab-btn").should("have.length", 2);
        });

        it("Sign In pill is active by default", () => {
            cy.visit("/session/begin");
            cy.contains(".login-tab-btn.active", "Sign In").should("have.attr", "aria-selected", "true");
            cy.contains("a.login-tab-btn", "Sign Up").should("not.have.class", "active");
        });

        it("Sign Up pill links to Shepherd's account-request page", () => {
            cy.visit("/session/begin");
            cy.contains("a.login-tab-btn", "Sign Up")
                .should("have.attr", "href")
                .and("include", "/session/signup");
        });

        it("Login form remains visible beside the account-request option", () => {
            cy.visit("/session/begin");
            cy.get("input[name='User']").should("be.visible");
            cy.get("input[name='Password']").should("be.visible");
            cy.get(".btn-sign-in").should("be.visible");
        });
    });

    describe("Password Reset Page Styling", () => {
        beforeEach(() => {
            cy.visit("/session/forgot-password/reset-request");
        });

        it("Should have page-auth body class", () => {
            cy.get("body").should("have.class", "page-auth");
        });

        it("Should render forgot-password card with visible form", () => {
            cy.get(".forgot-password-card").should("be.visible");
            cy.get("input[name='username']").should("be.visible");
        });

        it("Should render reset button with auth-specific gradient styling", () => {
            cy.get(".btn-reset").should("be.visible")
                .invoke("css", "background-image")
                .should("include", "gradient");
        });
    });

    describe("Password Reset Error Page Styling", () => {
        it("Should render scoped alert on auth error page", () => {
            cy.visit("/session/forgot-password/set/invalid-token-css-test");

            cy.get("body").should("have.class", "page-auth");
            cy.get(".alert.alert-danger").should("be.visible");
            cy.get(".alert-buttons").should("be.visible");
            // Buttons inside alert-buttons should be styled
            cy.get(".alert-buttons a, .alert-buttons button").should("have.length.at.least", 1);
        });
    });

    describe("Login Page Query Parameters", () => {
        it("Should prefill username from query parameter", () => {
            cy.visit("/session/begin?username=test@user.com");
            cy.get('input[id="UserBox"]').should("have.value", "test@user.com");
        });
    });
});
