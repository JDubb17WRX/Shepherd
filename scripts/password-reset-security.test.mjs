import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const routeSource = readFileSync(join(repositoryRoot, "src/session/routes/password-reset.php"), "utf8");
const templateSource = readFileSync(
    join(repositoryRoot, "src/session/templates/password/password-confirm-reset.php"),
    "utf8",
);
const tokenSource = readFileSync(
    join(repositoryRoot, "src/ChurchCRM/model/ChurchCRM/Token.php"),
    "utf8",
);
const userSource = readFileSync(
    join(repositoryRoot, "src/ChurchCRM/model/ChurchCRM/User.php"),
    "utf8",
);

test("password reset GET renders confirmation without changing credentials", () => {
    const getRouteStart = routeSource.indexOf("$group->get('/set/{token}'");
    const postRouteStart = routeSource.indexOf("$group->post('/set/{token}'");

    assert.notEqual(getRouteStart, -1, "GET reset route must exist");
    assert.notEqual(postRouteStart, -1, "POST reset route must exist");
    assert.ok(postRouteStart > getRouteStart, "POST reset route must follow the GET confirmation route");

    const getRoute = routeSource.slice(getRouteStart, postRouteStart);
    assert.match(getRoute, /password\/password-confirm-reset\.php/);
    assert.doesNotMatch(getRoute, /->consume\s*\(/);
    assert.doesNotMatch(getRoute, /resetPasswordToRandom\s*\(/);
});

test("password reset POST requires CSRF and uses the atomic reset interface", () => {
    const postRouteStart = routeSource.indexOf("$group->post('/set/{token}'");
    const nextHandlerStart = routeSource.indexOf("function forgotPassword", postRouteStart);
    const postRoute = routeSource.slice(postRouteStart, nextHandlerStart);

    assert.match(postRoute, /->add\(new CSRFMiddleware\(\)\)/);
    assert.match(postRoute, /\$user->resetPasswordWithToken\(\$tokenValue\)/);
    assert.doesNotMatch(postRoute, /\$token->consume\s*\(/);
    assert.doesNotMatch(postRoute, /resetPasswordToRandom\s*\(/);
});

test("confirmation form posts the session CSRF token", () => {
    assert.match(templateSource, /<form method="post"/);
    assert.match(templateSource, /CSRFUtils::getTokenInputField\(\)/);
    assert.doesNotMatch(templateSource, /method="get"/i);
});

test("token consumption uses an expiry-aware compare-and-swap update", () => {
    const consumeMethod = tokenSource.slice(tokenSource.indexOf("public function consume(): bool"));

    assert.match(consumeMethod, /->select\('RemainingUses'\)\s*->findOne\(\)/);
    assert.match(consumeMethod, /->filterByRemainingUses\(\$remainingUses\)/);
    assert.match(
        consumeMethod,
        /->filterByValidUntilDate\(DateTimeUtils::getToday\(\), Criteria::GREATER_THAN\)/,
    );
    assert.match(consumeMethod, /->update\(\['RemainingUses' => \$remainingUses - 1\]\)/);
    assert.doesNotMatch(consumeMethod, /\$this->save\s*\(/);
});

test("password reset claim and credential rotation share one user-row transaction", () => {
    const methodStart = userSource.indexOf("public function resetPasswordWithToken");
    const methodEnd = userSource.indexOf("private function deletePasswordResetTokens", methodStart);
    const resetMethod = userSource.slice(methodStart, methodEnd);

    assert.notEqual(methodStart, -1, "atomic token reset method must exist");
    assert.match(resetMethod, /->beginTransaction\(\)/);
    assert.match(resetMethod, /FOR UPDATE/);
    assert.match(resetMethod, /token = \? AND type = 'password' AND reference_id = \?/);
    assert.match(resetMethod, /remainingUses > 0 AND valid_until_date > \?/);
    assert.match(
        resetMethod,
        /DateTimeUtils::getToday\(\)->format\('Y-m-d H:i:s'\)/,
    );
    const deletePosition = resetMethod.indexOf("$this->deletePasswordResetTokens($connection)");
    const passwordPosition = resetMethod.indexOf("UPDATE user_usr SET usr_Password");
    const commitPosition = resetMethod.indexOf("$connection->commit()");
    assert.ok(deletePosition >= 0, "transaction must invalidate sibling reset tokens");
    assert.ok(passwordPosition > deletePosition, "credentials rotate after the token claim");
    assert.ok(commitPosition > passwordPosition, "token claim and credential rotation commit together");
});

test("password reset issuance uses the same serialized user-row interface", () => {
    const resetRequestStart = routeSource.indexOf("function userPasswordReset");
    const resetRequestRoute = routeSource.slice(resetRequestStart);

    assert.match(resetRequestRoute, /\$user->issuePasswordResetToken\(\)/);
    assert.doesNotMatch(resetRequestRoute, /new Token\s*\(/);
    assert.doesNotMatch(resetRequestRoute, /->build\('password'/);
});

test("every successful password rotation invalidates outstanding reset links", () => {
    const methodRanges = [
        ["public function resetPasswordToRandom", "public function issuePasswordResetToken"],
        ["public function adminSetUserPassword", "public function userChangePassword"],
        ["public function userChangePassword", "private function getIsPasswordPermissible"],
    ];

    for (const [startMarker, endMarker] of methodRanges) {
        const start = userSource.indexOf(startMarker);
        const end = userSource.indexOf(endMarker, start);
        const method = userSource.slice(start, end);
        const passwordUpdate = method.indexOf("UPDATE user_usr SET usr_Password");
        const tokenInvalidation = method.indexOf("$this->deletePasswordResetTokens($connection)");
        const commit = method.indexOf("$connection->commit()");

        assert.ok(start >= 0 && end > start, `${startMarker} must exist`);
        assert.ok(passwordUpdate >= 0, `${startMarker} must rotate the password in its transaction`);
        assert.ok(tokenInvalidation > passwordUpdate, `${startMarker} must invalidate reset links`);
        assert.ok(commit > tokenInvalidation, `${startMarker} must commit invalidation with the password`);
    }
});
