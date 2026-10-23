import { completeLogin, totp } from "./authentication";

const validateAdmin = () => cy.request("/api/deposits").its("status").should("eq", 200);

export function enrollFreshAdmin() {
    cy.location("pathname").should("include", "/v2/user/current/manage2fa");
    cy.request({ url: "/api/deposits", failOnStatusCode: false }).its("status").should("eq", 403);
    cy.intercept("POST", "**/api/user/current/refresh2fasecret").as("provisionFactor");
    cy.intercept("POST", "**/api/user/current/test2FAEnrollmentCode").as("confirmFactor");
    cy.intercept("POST", "**/api/user/current/refresh2farecoverycodes").as("recoveryCodes");
    cy.get("#begin2faEnrollment").click();
    cy.wait("@provisionFactor").then(({ response }) => {
        expect(response.statusCode).to.eq(200);
        const secret = response.body.TwoFASecret;
        expect(secret).to.be.a("string").and.not.be.empty;
        const serverTime = Date.parse(response.headers.date);
        expect(Number.isFinite(serverTime), "server Date header").to.eq(true);
        const counter = Math.floor(serverTime / 30000) + 1;
        cy.wait(counter * 30000 - serverTime + 1000, { log: false });
        cy.then(() => totp(secret, counter)).then((code) => {
            // The enrollment component replaces its input after each input event.
            cy.get("#totp-input").invoke("val", code).trigger("input");
        });
        cy.wait("@confirmFactor").then(({ response: confirmation }) => {
            expect(confirmation.statusCode).to.eq(200);
            expect(confirmation.body.IsEnrollmentCodeValid).to.eq(true);
        });
        cy.task("freshInstall:rememberFactor", secret, { log: false });
    });
    cy.wait("@recoveryCodes").its("response.statusCode").should("eq", 200);
    cy.contains("a.btn-primary", "Done").click();
    cy.request("/api/user/current/2fa-status").its("body.IsEnabled").should("eq", true);
    validateAdmin();
    cy.visit("/admin/system/church-info");
}

export function finishFreshAdminLogin() {
    cy.location("pathname").should("not.include", "/session/begin");
    return cy.location("pathname").then((path) => {
        if (path.includes("/changepassword")) return;
        if (path.endsWith("/manage2fa")) return enrollFreshAdmin();
        if (path.endsWith("/session/two-factor")) {
            return cy.task("freshInstall:factor", null, { log: false }).then((secret) =>
                completeLogin("admin", { secret, validate: validateAdmin }),
            );
        }
        return validateAdmin();
    });
}
