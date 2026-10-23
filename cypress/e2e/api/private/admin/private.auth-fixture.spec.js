describe("Seeded administrator API authentication", () => {
    it("allows the enrolled administrator to read deposits", () => {
        cy.makePrivateAdminAPICall("GET", "/api/deposits", null, 200);
    });

    it("rejects an invalid API key", () => {
        cy.clearAllCookies();
        cy.makePrivateAPICall("invalid-fixture-api-key", "GET", "/api/deposits", null, 401);
    });
});
