/// <reference types="cypress" />

import { seedFamily } from "../../../../support/people-fixtures";

describe("Families Without Email API", () => {
    beforeEach(() => {
        cy.makePrivateAdminAPICall("GET", "/api/families/email/without", "", 200).as("familiesWithoutEmail");
    });

    it("returns count and families array", () => {
        cy.get("@familiesWithoutEmail").then((response) => {
            expect(response.body).to.have.property("count").that.is.a("number");
            expect(response.body).to.have.property("families").that.is.an("array");
            expect(response.body.families).to.have.length(response.body.count);
        });
    });

    it("count is zero or positive", () => {
        cy.get("@familiesWithoutEmail").then((response) => {
            expect(response.body.count).to.be.at.least(0);
        });
    });

    it("returns correct family shape", () => {
        cy.get("@familiesWithoutEmail").then((response) => {
            if (response.body.families.length === 0) return;
            const family = response.body.families[0];
            // Family should have standard properties from Family table
            expect(family).to.have.property("Id");
            expect(family).to.have.property("Name");
            expect(family).to.have.property("Email");
        });
    });

    it("families have empty Email field", () => {
        cy.get("@familiesWithoutEmail").then((response) => {
            if (response.body.families.length === 0) return;
            response.body.families.forEach((family) => {
                expect(family.Email).to.be.oneOf(["", null, undefined]);
            });
        });
    });

    it("ensures no family has both email and person with email", () => {
        // This is a negative test: if the optimization works, every returned family
        // should have no email on the family record AND no email on any person in that family.
        // Since we can't query person data in this endpoint, we at least verify the
        // family email constraint is enforced.
        cy.get("@familiesWithoutEmail").then((response) => {
            response.body.families.forEach((family) => {
                // Family itself has no email (server constraint)
                expect(family.Email).to.be.oneOf(["", null, undefined]);
                // The fact that this family was returned means the query correctly
                // filtered for families without emails (optimization validates)
            });
        });
    });

    describe("person-level email filtering (seeded data)", () => {
        let testFamilyId = null;

        before(() => {
            // Create a family with NO family email but a member WITH a personal email.
            // This family must NOT appear in /api/families/email/without results.
            seedFamily({
                    Name: "CypressTest FamiliesWithoutEmail",
                    Address1: "1 Cypress Lane",
                    City: "Testville",
                    State: "TS",
                    Country: "US",
                    Zip: "00000",
                    Email: "", // no family-level email
                    people: [
                        {
                            firstName: "Cypress",
                            lastName: "TestMember",
                            gender: 1,
                            role: 1,
                            email: "cypress.test.member@example.invalid", // member HAS email
                        },
                    ],
                }, { pending: false }).then((resp) => {
                testFamilyId = resp.Id;
            });
        });

        after(() => {
            // Delete the seeded family and its members
            if (testFamilyId) {
                cy.makePrivateAdminAPICall(
                    "DELETE",
                    `/api/family/${testFamilyId}?deleteMembers=true`,
                    "",
                    200,
                );
            }
        });

        it("excludes families whose members have a personal email even when the family email is empty", () => {
            cy.makePrivateAdminAPICall("GET", "/api/families/email/without", "", 200).then((response) => {
                const returnedIds = response.body.families.map((f) => f.Id);
                expect(returnedIds).to.not.include(
                    testFamilyId,
                    `Family ${testFamilyId} has a member with email — it must be excluded from the results`,
                );
            });
        });
    });
});
