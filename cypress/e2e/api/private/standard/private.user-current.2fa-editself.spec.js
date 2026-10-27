/// <reference types="cypress" />

import { totp } from "../../../../support/authentication";

describe("EditSelf-only account security", () => {
    it("allows read-only status with an API key", () => {
        cy.makePrivateEditSelfAPICall("GET", "/api/user/current/2fa-status", null, 200)
            .its("body.IsEnabled").should("be.a", "boolean");
    });

    ["refresh2fasecret", "refresh2farecoverycodes", "remove2fasecret", "test2FAEnrollmentCode"].forEach((action) => {
        it(`rejects API-key authorization for ${action}`, () => {
            cy.makePrivateEditSelfAPICall("POST", `/api/user/current/${action}`, { enrollmentCode: "000000" }, 403);
        });
    });

    it("does not expose the retired QR-secret endpoint", () => {
        cy.makePrivateEditSelfAPICall("GET", "/api/user/current/get2faqrcode", null, 404);
    });

    it("keeps unrelated internal APIs forbidden", () => {
        cy.makePrivateEditSelfAPICall("GET", "/api/person/99", null, 403);
        cy.makePrivateEditSelfAPICall("GET", "/api/family/20", null, 403);
        cy.makePrivateEditSelfAPICall("GET", "/api/user/99/setting/ui.style", null, 403);
    });

    describe("completed browser authentication", () => {
        let csrfToken;
        const post = (action, body = {}) => cy.request({
            method: "POST", url: `/api/user/current/${action}`, body,
            headers: { "X-CSRF-Token": csrfToken },
        });

        beforeEach(() => {
            cy.setupLoginSession("editself-security", "limited.user", "changeme", { forceLogin: true });
            cy.request("/v2/user/current/manage2fa").then((page) => {
                csrfToken = Cypress.$(page.body).find('input[name="csrf_token"]').val();
                expect(csrfToken).to.match(/^[a-f0-9]{64}$/);
            });
        });

        after(() => {
            if (csrfToken) post("remove2fasecret");
        });

        it("requires CSRF, then enrolls and generates recovery codes", () => {
            cy.request({ method: "POST", url: "/api/user/current/refresh2fasecret", body: {}, failOnStatusCode: false })
                .its("status").should("eq", 403);
            post("reauthenticate", { currentPassword: "changeme" });
            post("refresh2fasecret").then((response) => {
                expect(response.body.TwoFAQRCodeDataUri).to.match(/^data:image\/png;base64,/);
                const counter = Math.floor(Date.parse(response.headers.date) / 30000);
                cy.then(() => totp(response.body.TwoFASecret, counter)).then((code) =>
                    post("test2FAEnrollmentCode", { enrollmentCode: code })
                        .its("body.IsEnrollmentCodeValid").should("eq", true));
            });
            post("refresh2farecoverycodes").its("body.TwoFARecoveryCodes").should("be.an", "array").and("not.be.empty");
            cy.request("/api/user/current/2fa-status").its("body.IsEnabled").should("eq", true);
        });
    });
});
