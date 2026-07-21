import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const caddyfileUrl = new URL("./Caddyfile", import.meta.url);
const caddyfile = readFileSync(caddyfileUrl, "utf8");
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
