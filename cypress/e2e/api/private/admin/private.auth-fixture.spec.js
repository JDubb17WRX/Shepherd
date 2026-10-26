describe("Seeded administrator API authentication", () => {
    it("allows the enrolled administrator to read deposits", () => {
        cy.makePrivateAdminAPICall("GET", "/api/deposits", null, 200);
    });

    it("rejects an invalid API key", () => {
        cy.clearAllCookies();
        cy.makePrivateAPICall("invalid-fixture-api-key", "GET", "/api/deposits", null, 401);
    });

    it("accepts an empty legacy GET body", () => {
        cy.makePrivateAdminAPICall("GET", "/api/deposits", "", 200);
    });

    it("preserves API cart state separately for each API key", () => {
        cy.makePrivateAdminAPICall("DELETE", "/api/cart/", null, 200);
        cy.makePrivateAdminAPICall("POST", "/api/cart/", { Persons: [2, 3] }, 200);
        cy.makePrivateAdminAPICall("GET", "/api/cart/", null, 200)
            .its("body.PeopleCart").should("include.members", [2, 3]);
        cy.makePrivateUserAPICall("GET", "/api/cart/", null, 200)
            .its("body.PeopleCart").should("have.length", 0);
        cy.makePrivateAdminAPICall("GET", "/api/cart/", null, 200)
            .its("body.PeopleCart").should("include.members", [2, 3]);
        cy.makePrivateAdminAPICall("DELETE", "/api/cart/", null, 200);
    });
});
