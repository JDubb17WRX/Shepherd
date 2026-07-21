/// <reference types="cypress" />

describe("Standard user localization metadata", () => {
    const userId = 3;

    beforeEach(() => {
        cy.setupStandardSession();
    });

    afterEach(() => {
        cy.makePrivateUserAPICall(
            "POST",
            `/api/user/${userId}/setting/ui.locale`,
            { value: "en_US" },
            200,
        );
    });

    for (const [locale, language, direction] of [
        ["en_US", "en-US", null],
        ["es_MX", "es-MX", null],
        ["he_IL", "he-IL", "rtl"],
    ]) {
        it(`declares ${language} metadata for ${locale}`, () => {
            cy.makePrivateUserAPICall(
                "POST",
                `/api/user/${userId}/setting/ui.locale`,
                { value: locale },
                200,
            );

            cy.visit("/v2/dashboard");
            cy.get("html").should("have.attr", "lang", language);
            if (direction === null) {
                cy.get("html").should("not.have.attr", "dir");
            } else {
                cy.get("html").should("have.attr", "dir", direction);
            }
        });
    }
});
