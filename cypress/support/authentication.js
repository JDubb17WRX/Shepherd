const fixtureSecrets = {
    admin: "JBSWY3DPEHPK3PXP",
    "locale-admin@churchcrm.test": "JBSWY3DPEHPK3PXP",
};

export async function totp(secret, counter) {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    const bits = [...secret.toUpperCase()].map((char) => {
        const value = alphabet.indexOf(char);
        if (value < 0) throw new Error("Invalid fixture TOTP secret");
        return value.toString(2).padStart(5, "0");
    }).join("");
    const bytes = Uint8Array.from(bits.match(/.{8}/g), (byte) => parseInt(byte, 2));
    const key = await crypto.subtle.importKey("raw", bytes, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
    const message = new ArrayBuffer(8);
    new DataView(message).setBigUint64(0, BigInt(counter));
    const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, message));
    const offset = digest[digest.length - 1] & 15;
    const value = new DataView(digest.buffer).getUint32(offset) & 0x7fffffff;
    return String(value % 1000000).padStart(6, "0");
}

export function validateAuthenticatedSession() {
    return cy.request({ url: "/portal/", headers: { Accept: "text/html" }, followRedirect: false, failOnStatusCode: false })
        .its("status").should("eq", 200);
}

export function completeLogin(username, options = {}) {
    cy.location("pathname").should("not.match", /\/session\/begin\/?$/);
    return cy.location("pathname").then((path) => {
        if (!path.endsWith("/session/two-factor")) return;
        const secret = options.secret ?? fixtureSecrets[username.toLowerCase()];
        if (!secret) throw new Error(`No enrolled TOTP fixture for ${username}`);
        // Start a new server-time interval so a prior login cannot have consumed this code.
        return cy.request("/session/two-factor").then((response) => {
            const serverTime = Date.parse(response.headers.date);
            expect(Number.isFinite(serverTime), "server Date header").to.eq(true);
            const counter = Math.floor(serverTime / 30000) + 1;
            cy.wait(counter * 30000 - serverTime + 1000, { log: false });
            cy.then(() => totp(secret, counter)).then((code) => {
                cy.get('input[name="TwoFACode"]').type(`${code}{enter}`, { log: false });
            });
            cy.location("pathname").should("not.include", "/session/two-factor");
        });
    }).then(() => (options.validate ?? validateAuthenticatedSession)());
}
