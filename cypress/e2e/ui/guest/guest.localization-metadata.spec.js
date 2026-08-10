/// <reference types="cypress" />

describe("Guest localization metadata", () => {
    it("declares the active locale as the document language", () => {
        cy.visit("/login");

        cy.window().then((win) => {
            const expectedLanguage = win.CRM.locale.replaceAll("_", "-");

            cy.get("html").should("have.attr", "lang", expectedLanguage);
            if (win.CRM.isRTL) {
                cy.get("html").should("have.attr", "dir", "rtl");
            } else {
                cy.get("html").should("not.have.attr", "dir");
            }
        });
    });
});
