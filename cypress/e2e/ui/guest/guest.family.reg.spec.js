/// <reference types="cypress" />

describe("Shepherd guest registration policy", () => {
    it("does not expose the anonymous family registration page", () => {
        cy.request({ url: "/external/register/", failOnStatusCode: false }).its("status").should("eq", 404);
    });

    ["family", "person"].forEach((kind) => {
        it(`refuses anonymous ${kind} creation`, () => {
            cy.request({ method: "POST", url: `/api/public/register/${kind}`, body: {}, failOnStatusCode: false })
                .its("status").should("eq", 403);
        });
    });

    it("directs guests to the email-verified account request form", () => {
        cy.visit("/session/begin");
        cy.get('a[href$="/session/signup"]').click();
        cy.contains("Verify your email, then wait for an administrator to approve access.").should("be.visible");
        for (const selector of ["#first-name", "#last-name", "#signup-email", "#signup-username"]) {
            cy.get(selector).should("be.visible").and("have.attr", "required");
        }
        cy.get('button[type="submit"]').should("contain.text", "Send verification email");
    });
});
