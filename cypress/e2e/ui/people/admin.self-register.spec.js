/// <reference types="cypress" />

import { seedPerson, seedFamily } from "../../../support/people-fixtures";

const visitReview = () => {
    cy.intercept("GET", "**/api/families/self-register").as("reviewFamilies");
    cy.intercept("GET", "**/api/persons/self-register").as("reviewPeople");
    cy.visit("/people/self-register");
    cy.wait(["@reviewFamilies", "@reviewPeople"]);
};

describe("Self Registrations review page", () => {
    const created = { persons: [], families: [] };
    const unique = (prefix) => `${prefix}${Date.now()}${Math.floor(Math.random() * 1000)}`;

    const registerPerson = (lastName = unique("PendingUi")) =>
        seedPerson({ firstName: "Cypress", lastName, email: "pending-ui@example.com", gender: 1 }).then((resp) => {
                created.persons.push(resp.Id);
                return { id: resp.Id, lastName };
            });

    const registerFamily = (name = unique("PendingFamUi")) =>
        seedFamily({
                    Name: name,
                    Address1: "1 Review St",
                    Address2: "",
                    City: "Testville",
                    State: "TS",
                    Country: "US",
                    Zip: "12345",
                    HomePhone: "(555) 123-4567",
                    Email: "pendingfam-ui@example.com",
                    people: [
                        {
                            firstName: "Fam",
                            lastName: "Member",
                            gender: 1,
                            role: 1,
                            email: "member-ui@example.com",
                            cellPhone: "",
                            homePhone: "",
                            workPhone: "",
                            birthday: "01/15/1980",
                            hideAge: false,
                        },
                    ],
                }).then((resp) => {
                created.families.push(resp.Id);
                return { id: resp.Id, name };
            });

    const row = (text) => cy.get("#selfRegistrations tbody tr", { timeout: 10000 }).contains("tr", text);


    after(() => {
        created.persons.forEach((id) => {
            cy.makePrivateAdminAPICall("DELETE", `/api/person/${id}`, null, [200, 404]);
        });
        created.families.forEach((id) => {
            cy.makePrivateAdminAPICall("DELETE", `/api/family/${id}?deleteMembers=true`, null, [200, 404]);
        });
    });

    describe("Navigation", () => {
        beforeEach(() => cy.setupAdminSession());

        it("lists Self Registrations in the People menu", () => {
            cy.visit("/people/dashboard");
            cy.get('a.nav-link[href$="people/self-register"]').should("exist").and("contain", "Self Registrations");
        });

        it("no longer links to the page from the dashboard quick actions", () => {
            cy.visit("/people/dashboard");
            cy.contains(".card-title", "Quick Actions").closest(".card").find('a[href*="self-register"]').should("not.exist");
        });

        it("shows a review action on the home dashboard when registrations are waiting", () => {
            registerPerson();
            cy.visit("/v2/dashboard");
            cy.get("#selfRegisterDashboardAlert", { timeout: 10000 }).should("be.visible").and("contain", "waiting for review");
            cy.get("#selfRegisterDashboardAlert a").should("have.attr", "href").and("include", "/people/self-register");
        });

        it("shows a pending badge in the menu when registrations are waiting", () => {
            registerPerson();
            cy.visit("/people/dashboard");
            cy.get("#selfRegisterPending", { timeout: 10000 }).should("not.have.class", "d-none");
        });
    });

    describe("Status and counters", () => {
        beforeEach(() => cy.setupAdminSession());

        it("shows the registration status with a link to People Settings for admins", () => {
            visitReview();
            cy.contains(".alert", "Self-registration is disabled");
            cy.contains(".alert a", "Change in People Settings").should("have.attr", "href").and("include", "/admin/people");
        });

        it("shows pending, approved and total counters", () => {
            visitReview();
            cy.contains(".card-sm", "Pending review");
            cy.contains(".card-sm", "Approved");
            cy.contains(".card-sm", "Total registrations");
        });
    });

    describe("Pending list", () => {
        beforeEach(() => cy.setupAdminSession());

        it("groups pending registrations by month and shows the registration date", () => {
            registerPerson().then(({ lastName }) => {
                visitReview();
                row(lastName);
                const month = new Date().toLocaleString("en-US", { month: "long", year: "numeric" });
                cy.get("#selfRegistrations tr.month-group").should("contain", month);
                row(lastName).find("td").eq(4).invoke("text").should("match", /\d{4}/);
            });
        });

        it("shows a pending family's member names, address, contact and age", () => {
            registerFamily().then(({ name }) => {
                visitReview();
                row(name).should("contain", "Fam").and("contain", "1 Review St").and("contain", "member-ui@example.com");
                // Registered moments ago; a run that crosses midnight renders "Yesterday" instead of "Today".
                row(name).invoke("text").should("match", /Today|Yesterday/);
            });
        });

        it("lists a pending family and not an approved one", () => {
            registerFamily().then(({ id, name }) => {
                visitReview();
                row(name).should("exist");
                cy.makePrivateAdminAPICall("POST", `/api/family/${id}/approve-review`, null, 200);
                visitReview();
                cy.get("#selfRegistrations tbody").should("not.contain", name);
            });
        });
    });

    describe("Selecting and approving", () => {
        beforeEach(() => cy.setupAdminSession());

        it("enables Approve selected only while rows are ticked", () => {
            registerPerson().then(({ lastName }) => {
                visitReview();
                cy.get("#approveSelected").should("be.disabled");
                row(lastName).find(".row-select").check();
                cy.get("#approveSelected").should("not.be.disabled");
                cy.get("#selectedCount").should("have.text", "1");
                row(lastName).find(".row-select").uncheck();
                cy.get("#approveSelected").should("be.disabled");
            });
        });

        it("select-all and month checkboxes tick every row", () => {
            registerPerson();
            registerPerson();
            visitReview();
            cy.get("#selfRegistrations .row-select").should("have.length.at.least", 2);
            cy.get("#selectAll").check();
            cy.get("#selfRegistrations .row-select:not(:checked)").should("have.length", 0);
            cy.get("#selectAll").uncheck();
            cy.get("#selfRegistrations .row-select:checked").should("have.length", 0);
            cy.get("#selfRegistrations .month-select").first().check();
            cy.get("#selfRegistrations .row-select:checked").should("have.length.at.least", 1);
        });

        it("approves several selected registrations in one request", () => {
            registerPerson().then(({ lastName: first }) => {
                registerPerson().then(({ lastName: second }) => {
                    cy.intercept("POST", "**/api/persons/self-register/approve").as("batchApprove");
                    visitReview();
                    row(first).find(".row-select").check();
                    row(second).find(".row-select").check();
                    cy.get("#approveSelected").click();
                    cy.wait("@batchApprove").its("response.statusCode").should("eq", 200);
                    cy.get("#selfRegistrations tbody").should("not.contain", first).and("not.contain", second);
                });
            });
        });

        it("approves one registration from its row menu", () => {
            registerPerson().then(({ lastName }) => {
                cy.intercept("POST", "**/approve-review").as("approveOne");
                visitReview();
                cy.get("#selfRegPending").invoke("text").then((pendingBefore) => {
                    cy.get("#selfRegApproved").invoke("text").then((approvedBefore) => {
                        row(lastName).find('[data-bs-toggle="dropdown"]').click();
                        cy.get(".dropdown-menu.show .approve-review").click();
                        cy.wait("@approveOne").its("response.statusCode").should("eq", 200);
                        cy.get("#selfRegistrations tbody").should("not.contain", lastName);
                        cy.get("#selfRegPending").should(($el) => expect(Number($el.text())).to.eq(Number(pendingBefore) - 1));
                        cy.get("#selfRegApproved").should(($el) => expect(Number($el.text())).to.eq(Number(approvedBefore) + 1));
                    });
                });
            });
        });
    });

    describe("Pending badges elsewhere", () => {
        beforeEach(() => cy.setupAdminSession());

        it("marks a pending person in the person list and view, and clears it on approval", () => {
            registerPerson().then(({ id, lastName }) => {
                cy.visit("/people/list");
                cy.get(".dt-search input").first().type(lastName);
                cy.get("#members tbody", { timeout: 15000 }).should("contain", lastName).and("contain", "Pending review");

                cy.visit(`/people/view/${id}`);
                cy.contains("Pending review");

                cy.makePrivateAdminAPICall("POST", `/api/person/${id}/approve-review`, null, 200);
                cy.visit(`/people/view/${id}`);
                cy.contains(".badge", "Pending review").should("not.exist");
            });
        });

        it("marks a pending family in the family list and view", () => {
            registerFamily().then(({ id, name }) => {
                cy.visit("/people/family");
                cy.get(".dt-search input").first().type(name);
                cy.get("#families tbody", { timeout: 15000 }).should("contain", name).and("contain", "Pending review");

                cy.visit(`/people/family/${id}`);
                cy.contains(".alert", "pending review");
            });
        });

        it("does not mark staff-created people as pending", () => {
            cy.visit("/people/family/1");
            cy.contains(".alert", "pending review").should("not.exist");
        });
    });
});

describe("Self Registrations review page without EditRecords", () => {
    const login = () => {
        cy.clearCookies();
        cy.visit("/session/begin");
        cy.get("input[name=User]").type("noperm.user");
        cy.get("input[name=Password]").type("changeme{enter}");
        cy.url({ timeout: 10000 }).should("not.include", "/session/begin");
    };

    beforeEach(login);

    it("can read the page but gets no selection or approve controls", () => {
        visitReview();
        cy.contains(".card-sm", "Pending review");
        cy.get("#selfRegistrations").should("exist");
        cy.get(".row-select").should("not.exist");
        cy.get("#selectAll").should("not.exist");
        cy.get("#bulkBar").should("have.class", "d-none");
        cy.get(".approve-review").should("not.exist");
    });

    it("does not show the review action on the home dashboard", () => {
        cy.visit("/v2/dashboard");
        cy.get("#selfRegisterDashboardAlert").should("not.exist");
    });

    it("does not offer the settings link to non-admins", () => {
        visitReview();
        cy.contains(".alert a", "Change in People Settings").should("not.exist");
    });
});
