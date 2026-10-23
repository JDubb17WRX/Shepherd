async function apiRequest({ baseUrl, key, method, url, body, timeout = 15000 }) {
    const base = new URL(baseUrl);
    const target = new URL(url.replace(/^\/+/, ""), `${base.href.replace(/\/$/, "")}/`);
    if (target.origin !== base.origin || !["http:", "https:"].includes(target.protocol)) {
        throw new Error("API fixtures must target the configured test server");
    }
    const response = await fetch(target, {
        method,
        headers: { "content-type": "application/json", "x-api-key": key },
        body: body == null ? undefined : typeof body === "string" ? body : JSON.stringify(body),
        redirect: "manual",
        signal: AbortSignal.timeout(timeout),
    });
    const text = await response.text();
    return {
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: text && response.headers.get("content-type")?.includes("application/json") ? JSON.parse(text) : text,
    };
}

module.exports = { apiRequest };
