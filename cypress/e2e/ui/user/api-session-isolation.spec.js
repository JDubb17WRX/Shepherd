describe("API-key and browser session isolation", () => {
    it("does not let an administrator browser session authorize an invalid API key", () => {
        cy.setupAdminSession();
        cy.getAllCookies().then((cookies) => {
            cy.makePrivateAPICall("invalid-fixture-key", "GET", "/api/deposits", null, 401);
            cy.getAllCookies().should("deep.equal", cookies);
        });
        cy.request("/api/deposits").its("status").should("eq", 200);
        cy.visit("/portal/");
        cy.location("pathname").should("include", "/portal");
    });

    it("does not elevate a browser session when an administrator API key is used", () => {
        cy.setupNoFinanceSession();
        const denied = () => cy.request({ url: "/api/deposits", failOnStatusCode: false })
            .its("status").should("eq", 403);
        denied();
        cy.getAllCookies().then((cookies) => {
            cy.makePrivateAdminAPICall("GET", "/api/deposits", null, 200);
            cy.getAllCookies().should("deep.equal", cookies);
        });
        denied();
    });
});
