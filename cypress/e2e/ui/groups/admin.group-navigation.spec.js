/// <reference types="cypress" />

describe("Admin group header navigation", () => {
    const groupID = 9;

    beforeEach(() => cy.setupAdminSession());

    it("links group view to its editor without duplicating the application root", () => {
        cy.visit(`/groups/view/${groupID}`);
        cy.contains("a", "Edit Group")
            .should("have.attr", "href")
            .and("match", new RegExp(`/groups/editor/${groupID}$`));
    });

    it("links group editor back to its view without duplicating the application root", () => {
        cy.visit(`/groups/editor/${groupID}`);
        cy.contains("a", "Back to Group")
            .should("have.attr", "href")
            .and("match", new RegExp(`/groups/view/${groupID}$`));
    });
});
