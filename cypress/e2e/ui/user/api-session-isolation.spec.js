describe("API-key and browser session isolation", () => {
    it("keeps the API cart separate from the browser cart", () => {
        cy.setupAdminSession();
        cy.request("DELETE", "/api/cart/");
        cy.makePrivateAdminAPICall("POST", "/api/cart/", { Persons: [2, 3] }, 200);
        cy.request("/api/cart/").its("body.PeopleCart").should("have.length", 0);
        cy.makePrivateAdminAPICall("GET", "/api/cart/", null, 200)
            .its("body.PeopleCart").should("include.members", [2, 3]);
        cy.makePrivateAdminAPICall("DELETE", "/api/cart/", null, 200);
    });
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
