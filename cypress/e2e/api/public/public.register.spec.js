/// <reference types="cypress" />

describe("API Public Registration — Shepherd policy", () => {
    it("Should keep family registration disabled for valid data", () => {
        const testFamily = {
            Name: "Cypress Test Family",
            Address1: "123 Test Street",
            Address2: "",
            City: "Testville",
            State: "TS",
            Country: "US",
            Zip: "12345",
            HomePhone: "(555) 123-4567",
            Email: "test@example.com",
            people: [
                {
                    firstName: "John",
                    lastName: "Tester",
                    gender: 1,
                    role: 1,
                    email: "john@example.com",
                    cellPhone: "(555) 987-6543",
                    homePhone: "",
                    workPhone: "",
                    birthday: "01/15/1980",
                    hideAge: false
                }
            ]
        };

        cy.request({
            method: "POST",
            url: "/api/public/register/family",
            body: testFamily,
            failOnStatusCode: false,
        }).then((resp) => {
            expect(resp.status).to.eq(403);
        });
    });

    it("Should reject invalid family data before public validation while disabled", () => {
        const invalidFamily = {
            Name: "", // Empty name should fail validation
            Address1: "",
            City: "",
            State: "",
            Country: "",
            Zip: "",
            HomePhone: "",
            Email: "",
            people: []
        };

        cy.request({
            method: "POST",
            url: "/api/public/register/family",
            body: invalidFamily,
            failOnStatusCode: false
        }).then((resp) => {
            expect(resp.status).to.eq(403);
        });
    });
});
