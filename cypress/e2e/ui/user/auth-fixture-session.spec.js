describe("Enrolled administrator sessions", () => {
    const verifyFinanceAccess = () => cy.request("/api/deposits").its("status").should("eq", 200);

    it("completes 2FA and restores the cached administrator session", () => {
        cy.setupAdminSession({ forceLogin: true });
        verifyFinanceAccess();
        cy.setupAdminSession();
        verifyFinanceAccess();
        cy.clearAllCookies();
        cy.setupAdminSession();
        verifyFinanceAccess();
    });

    it("completes a fresh administrator form login", () => {
        cy.freshAdminFormLogin({ clearAll: true });
        verifyFinanceAccess();
    });

    it("completes a custom administrator login", () => {
        cy.readEnv("admin.username").then((username) => {
            cy.readEnv("admin.password").then((password) => {
                cy.loginWithCredentials(username, password, "enrolled-admin-custom");
            });
        });
        verifyFinanceAccess();
    });

    it("preserves password-only login for a standard user", () => {
        cy.setupStandardSession();
        cy.request({ url: "/portal/", followRedirect: false }).its("status").should("eq", 200);
    });
});
