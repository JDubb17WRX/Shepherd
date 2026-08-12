/// <reference types="cypress" />

describe("Family Registration — Shepherd policy", () => {
    it("does not expose the upstream family-registration page", () => {
        cy.request({
            url: "/external/register/",
            failOnStatusCode: false,
        }).its("status").should("eq", 404);
    });

    it("directs guests to Shepherd's reviewed account-request flow", () => {
        cy.visit("/session/begin");
        cy.contains("a.login-tab-btn", "Sign Up")
            .should("have.attr", "href")
            .and("include", "/session/signup");
    });
});
