import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const caddyfileUrl = new URL("./Caddyfile", import.meta.url);
const caddyfile = readFileSync(caddyfileUrl, "utf8");
const dockerfile = readFileSync(new URL("./Dockerfile", import.meta.url), "utf8");
const integrityService = readFileSync(
  new URL("../../src/ChurchCRM/Service/AppIntegrityService.php", import.meta.url),
  "utf8",
);
const lines = caddyfile.split(/\r?\n/u).map((line) => line.trim());
const matcher = lines.find((line) => line.startsWith("@privateMedia path_regexp privateMedia "));

assert.ok(matcher, "Caddyfile must define the @privateMedia path_regexp matcher");

const caddyExpression = matcher.replace(/^@privateMedia path_regexp privateMedia\s+/u, "");
const caseInsensitive = caddyExpression.startsWith("(?i)");
const javascriptExpression = caseInsensitive ? caddyExpression.slice(4) : caddyExpression;
const privateMediaPattern = new RegExp(javascriptExpression, caseInsensitive ? "iu" : "u");

function isPrivateMediaRequest(requestPath) {
  return privateMediaPattern.test(requestPath);
}

test("denies unauthenticated direct requests for private media sentinels", () => {
  const sentinels = [
    ["../../cypress/data/images/people/1.jpg", "/shepherd/Images/Person/1.jpg"],
    ["../../cypress/data/images/family/42.jpg", "/shepherd/Images/Family/42.jpg"],
  ];

  for (const [fixture, requestPath] of sentinels) {
    assert.ok(existsSync(new URL(fixture, import.meta.url)), `${fixture} must exist`);
    assert.ok(isPrivateMediaRequest(requestPath), `${requestPath} must be denied`);
  }
});

test("covers directory roots and descendants without matching neighboring routes", () => {
  for (const requestPath of [
    "/shepherd/Images/Person",
    "/shepherd/Images/Person/",
    "/shepherd/Images/Person/nested/1.jpg",
    "/SHEPHERD/images/person/1.jpg",
    "/shepherd/Images/Family",
    "/shepherd/Images/Family/",
    "/shepherd/Images/Family/nested/42.jpg",
  ]) {
    assert.ok(isPrivateMediaRequest(requestPath), `${requestPath} must be denied`);
  }

  for (const requestPath of [
    "/shepherd/Images/Personality/1.jpg",
    "/shepherd/Images/FamilyTree/42.jpg",
    "/shepherd/api/person/1/photo",
    "/shepherd/api/family/42/photo",
  ]) {
    assert.equal(isPrivateMediaRequest(requestPath), false, `${requestPath} must remain unmatched`);
  }
});

test("returns 404 before the Shepherd catch-all can serve private media", () => {
  const routeStart = lines.findIndex((line) => line === "route {");
  assert.ok(routeStart >= 0, "routing handlers must be enclosed in a literal-order route block");

  let depth = 0;
  const routeLines = [];
  for (let index = routeStart; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.endsWith(" {")) depth += 1;
    if (line === "}") depth -= 1;
    routeLines.push(line);
    if (depth === 0) break;
  }

  const responseIndex = routeLines.indexOf("respond @privateMedia 404");
  const catchAllIndex = routeLines.indexOf("handle /shepherd/* {");

  assert.ok(responseIndex >= 0, "the route block must contain the private-media denial");
  assert.ok(catchAllIndex >= 0, "the route block must contain the Shepherd catch-all");
  assert.ok(responseIndex < catchAllIndex, "the deny response must precede the catch-all");
});

test("protects database backups and all persisted uploads", () => {
  const protectedPaths = caddyfile.match(/@protected path[^\n]*/u)?.[0] || "";
  for (const path of [
    "/shepherd/Include",
    "/shepherd/logs",
    "/shepherd/tmp_attach",
    "/shepherd/SQL",
    "/shepherd/uploads",
  ]) {
    assert.match(protectedPaths, new RegExp(`${path}(?:\\s|$)`, "u"));
    assert.match(protectedPaths, new RegExp(`${path.replaceAll("/", "\\/")}\\/\\*`, "u"));
  }
  assert.match(caddyfile, /respond @protected 404/u);
});

test("declares configured Caddy rewriting to the prerequisite check", () => {
  assert.match(dockerfile, /CHURCHCRM_URL_REWRITING=1/u);
  assert.match(integrityService, /getenv\('CHURCHCRM_URL_REWRITING'\)/u);
  assert.match(integrityService, /Apache \/ nginx \/ LiteSpeed \/ Caddy/u);
});

test("keeps liveness independent from database-backed readiness", () => {
  assert.match(caddyfile, /handle \/shepherd\/livez\s*\{/u);
  assert.match(caddyfile, /respond `\{"status":"alive"\}` 200/u);
  assert.match(caddyfile, /handle \/shepherd\/healthz\s*\{[\s\S]*?healthz\.php/u);

  const workflow = readFileSync(new URL("../../.github/workflows/shepherd-image.yml", import.meta.url), "utf8");
  assert.match(workflow, /curl[^\n]*\/shepherd\/livez/u);
  assert.doesNotMatch(workflow, /curl[^\n]*\/shepherd\/healthz/u);
});
