const { CookieJar } = require("tough-cookie");

const sessions = new Map();

function resetApiSessions() {
    sessions.clear();
    return null;
}

async function apiRequest({ baseUrl, key, method, url, body, timeout = 15000 }) {
    const base = new URL(baseUrl);
    const target = new URL(url.replace(/^\/+/, ""), `${base.href.replace(/\/$/, "")}/`);
    if (target.origin !== base.origin || !["http:", "https:"].includes(target.protocol)) {
        throw new Error("API fixtures must target the configured test server");
    }
    const sessionKey = JSON.stringify([base.href, key]);
    if (!sessions.has(sessionKey)) sessions.set(sessionKey, new CookieJar());
    const jar = sessions.get(sessionKey);
    const headers = { "content-type": "application/json", "x-api-key": key };
    const cookie = await jar.getCookieString(target.href);
    if (cookie) headers.cookie = cookie;
    const requestMethod = method.toUpperCase();
    const hasBody = !["GET", "HEAD"].includes(requestMethod) && body != null;
    const response = await fetch(target, {
        method: requestMethod,
        headers,
        body: hasBody ? typeof body === "string" ? body : JSON.stringify(body) : undefined,
        redirect: "manual",
        signal: AbortSignal.timeout(timeout),
    });
    for (const cookie of response.headers.getSetCookie()) {
        await jar.setCookie(cookie, target.href, { ignoreError: true });
    }
    const text = await response.text();
    return {
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: text && response.headers.get("content-type")?.includes("application/json") ? JSON.parse(text) : text,
    };
}

module.exports = { apiRequest, resetApiSessions };
