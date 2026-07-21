import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function source(relativePath) {
    return readFileSync(join(repositoryRoot, relativePath), "utf8");
}

function between(contents, startMarker, endMarker) {
    const start = contents.indexOf(startMarker);
    assert.notEqual(start, -1, `missing start marker: ${startMarker}`);

    const end = endMarker === undefined ? contents.length : contents.indexOf(endMarker, start + startMarker.length);
    assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
    assert.ok(end > start, `end marker must follow start marker: ${endMarker}`);

    return contents.slice(start, end);
}

function assertOrdered(contents, markers) {
    let previous = -1;
    for (const marker of markers) {
        const position = contents.indexOf(marker);
        assert.notEqual(position, -1, `missing ordered marker: ${marker}`);
        assert.ok(position > previous, `marker is out of order: ${marker}`);
        previous = position;
    }
}

const localAuthenticationSource = source(
    "src/ChurchCRM/Authentication/AuthenticationProviders/LocalAuthentication.php",
);
const authenticationManagerSource = source("src/ChurchCRM/Authentication/AuthenticationManager.php");
const userModelSource = source("src/ChurchCRM/model/ChurchCRM/User.php");
const currentUserApiSource = source("src/api/routes/users/user-current.php");
const userApiSource = source("src/api/routes/users/user.php");
const passwordChangeRouteSource = source("src/v2/routes/user-current.php");
const adminSystemRouteSource = source("src/admin/routes/system.php");
const publicUserApiSource = source("src/api/routes/public/public-user.php");
const twoFactorClientSource = source("webpack/two-factor-enrollment.js");
const apiKeyClientSource = source("src/skin/js/user.js");
const adminUserClientSource = source("src/skin/js/users.js");

test("logout teardown remains fail-closed when logging fails", () => {
    const endSession = between(
        authenticationManagerSource,
        "public static function endSession",
        "public static function authenticate",
    );

    assertOrdered(endSession, [
        "LoggerUtils::getAuthLogger()",
        "self::getAuthenticationProvider()->endSession()",
        "$_SESSION = []",
        "session_unset()",
        "session_destroy()",
        "RedirectUtils::redirect(self::getSessionBeginURL())",
    ]);
    assert.equal(
        (endSession.match(/catch \(\\Throwable \$loggingError\)/g) ?? []).length,
        4,
        "every logout log write must be isolated from teardown and redirect handling",
    );
});

test("password, factor, recovery-code, and API-key mutations rotate the browser session ID", () => {
    const passwordSync = between(
        localAuthenticationSource,
        "public function synchronizeAuthenticatedPasswordHash",
        "public function synchronizeAuthenticatedTwoFactorSecret",
    );
    const factorSync = between(
        localAuthenticationSource,
        "public function synchronizeAuthenticatedTwoFactorSecret",
        "public function synchronizeAuthenticatedRecoveryCodes",
    );
    const recoverySync = between(
        localAuthenticationSource,
        "public function synchronizeAuthenticatedRecoveryCodes",
        "public function rotateAuthenticatedSessionAfterSecurityMutation",
    );
    for (const mutation of [passwordSync, factorSync, recoverySync]) {
        assert.match(mutation, /\$this->rotateAuthenticatedSessionAfterSecurityMutation\(\)/);
    }

    const rotation = between(
        localAuthenticationSource,
        "public function rotateAuthenticatedSessionAfterSecurityMutation",
        "private function synchronizeAuthenticatedSecurityState",
    );
    assert.match(rotation, /\$this->rotateSessionIdentifier\(\)/);

    const lowLevelRotation = between(
        localAuthenticationSource,
        "private function rotateSessionIdentifier",
        "private function preparePendingTwoFactorAuthentication",
    );
    assert.match(lowLevelRotation, /session_regenerate_id\(true\)/);

    const recoveryMutation = between(
        currentUserApiSource,
        "function refresh2farecoverycodes",
        "function remove2fasecret",
    );
    assert.match(recoveryMutation, /AuthenticationManager::synchronizeAuthenticatedRecoveryCodes\(/);

    const factorRemoval = between(
        currentUserApiSource,
        "function remove2fasecret",
        "function test2FAEnrollmentCode",
    );
    assert.match(factorRemoval, /AuthenticationManager::synchronizeAuthenticatedTwoFactorSecret\(null\)/);

    const factorEnrollment = between(
        currentUserApiSource,
        "function test2FAEnrollmentCode",
        "function get2FAStatus",
    );
    assert.match(factorEnrollment, /AuthenticationManager::synchronizeAuthenticatedTwoFactorSecret\(\$confirmedSecret\)/);

    const apiKeyMutation = between(userApiSource, "function genAPIKey", "function updateUserConfig");
    assertOrdered(apiKeyMutation, [
        "$user->regenerateApiKeyIfCurrent",
        "AuthenticationManager::rotateAuthenticatedSessionAfterSecurityMutation()",
        "$user->createTimeLineNote('api-key-regen')",
    ]);
    assert.match(apiKeyMutation, /catch \(\\Throwable \$exception\)/);
});

test("recovery-code state is bound into serialized sessions and fixed-lifetime security grants", () => {
    const serializedState = between(localAuthenticationSource, "public function __serialize", "public function __unserialize");
    assert.match(serializedState, /'primaryAuthenticationRecoveryCodes'\s*=>\s*\$this->primaryAuthenticationRecoveryCodes/);
    assert.match(
        serializedState,
        /'securityActionAuthenticationRecoveryCodes'\s*=>\s*\$this->securityActionAuthenticationRecoveryCodes/,
    );

    const restoredState = between(localAuthenticationSource, "public function __unserialize", "public function getPasswordChangeURL");
    assert.match(restoredState, /\$this->primaryAuthenticationRecoveryCodes\s*=\s*\$data\['primaryAuthenticationRecoveryCodes'\]/);
    assert.match(
        restoredState,
        /\$this->securityActionAuthenticationRecoveryCodes\s*=\s*\$data\['securityActionAuthenticationRecoveryCodes'\]/,
    );

    const grantValidation = between(
        localAuthenticationSource,
        "public function hasRecentSecurityActionAuthentication",
        "public function reauthenticateForSecurityAction",
    );
    assert.match(grantValidation, /\$recoveryStateMatches\s*=/);
    assert.match(grantValidation, /\$this->securityActionAuthenticationRecoveryCodes/);
    assert.match(grantValidation, /\$this->primaryAuthenticationRecoveryCodes/);
    assert.match(grantValidation, /!\$passwordStateMatches \|\| !\$twoFactorStateMatches \|\| !\$recoveryStateMatches/);

    const grantIssuance = between(
        localAuthenticationSource,
        "private function issueSecurityActionAuthentication",
        "private function rebindSecurityActionAuthenticationMarkers",
    );
    assert.match(
        grantIssuance,
        /\$this->securityActionAuthenticationRecoveryCodes\s*=\s*\$this->primaryAuthenticationRecoveryCodes/,
    );
});

test("recovery-code state participates in active-session validation and authentication finalization", () => {
    const sessionValidation = between(
        localAuthenticationSource,
        "public function validateUserSessionIsActive",
    );
    assert.match(sessionValidation, /\$currentRecoveryCodes\s*=\s*\$this->currentUser->getTwoFactorAuthRecoveryCodes\(\)/);
    assert.match(sessionValidation, /\$recoveryStateMatches\s*=/);
    assert.match(sessionValidation, /!\$passwordStateMatches \|\| !\$twoFactorStateMatches \|\| !\$recoveryStateMatches/);

    const successfulLogin = between(
        localAuthenticationSource,
        "private function prepareSuccessfulLoginOperations",
        "public function authenticate",
    );
    assert.match(
        successfulLogin,
        /\$this->currentUser->finalizeSuccessfulAuthentication\(\s*\$this->primaryAuthenticationPasswordHash,\s*\$this->primaryAuthenticationTwoFactorSecret,\s*\$this->primaryAuthenticationRecoveryCodes,/,
    );

    const finalization = between(
        userModelSource,
        "public function finalizeSuccessfulAuthentication",
        "public function resetPasswordToRandom",
    );
    assert.match(finalization, /\?string \$expectedRecoveryCodes/);
    assert.match(finalization, /usr_TwoFactorAuthRecoveryCodes/);
    assert.match(finalization, /\$recoveryStateMatches\s*=/);
    assert.match(finalization, /if \(!\$recoveryStateMatches\)/);
});

test("password changes use the lockout-aware reauthentication path before mutation", () => {
    const passwordChange = between(passwordChangeRouteSource, "function changepassword");
    assertOrdered(passwordChange, [
        "AuthenticationManager::reauthenticateForSecurityAction($loginRequestBody['OldPassword'])",
        "AuthenticationManager::getAuthenticatedSecurityMarkers()",
        "$curUser->userChangePassword(",
        "AuthenticationManager::synchronizeAuthenticatedPasswordHash($newPasswordHash)",
    ]);

    const reauthentication = between(
        localAuthenticationSource,
        "public function reauthenticateForSecurityAction",
        "public function synchronizeAuthenticatedPasswordHash",
    );
    assert.match(reauthentication, /\$this->currentUser->authenticatePrimaryPassword\(\$password\)/);
    assert.match(reauthentication, /\$primaryAuthentication\['isLocked'\]/);
    assert.match(reauthentication, /\$primaryAuthentication\['isPasswordValid'\]/);

    const primaryAuthentication = between(
        userModelSource,
        "public function authenticatePrimaryPassword",
        "public function finalizeSuccessfulAuthentication",
    );
    assert.match(primaryAuthentication, /self::getEffectiveMaximumFailedLogins\(\)/);
    assert.match(primaryAuthentication, /usr_FailedLogins/);
    assert.match(primaryAuthentication, /FOR UPDATE/);
});

test("bcrypt inputs longer than 72 bytes are rejected for verification and password changes", () => {
    assert.match(userModelSource, /private const MAX_BCRYPT_PASSWORD_BYTES = 72;/);

    const verification = between(userModelSource, "private function verifyPasswordHash", "public function hashPassword");
    assertOrdered(verification, [
        "strlen($password) > self::MAX_BCRYPT_PASSWORD_BYTES",
        "'isValid' => false",
        "password_verify($password, $storedHash)",
    ]);

    const hashing = between(userModelSource, "public function hashPassword", "private function legacyHashPassword");
    assert.match(hashing, /strlen\(\$password\) > self::MAX_BCRYPT_PASSWORD_BYTES/);
    assert.match(hashing, /throw new \\InvalidArgumentException\('Passwords cannot exceed 72 bytes when using bcrypt'\)/);

    const adminChange = between(userModelSource, "public function adminSetUserPassword", "public function userChangePassword");
    assert.match(adminChange, /strlen\(\$newPassword\) > self::MAX_BCRYPT_PASSWORD_BYTES/);
    assert.match(adminChange, /The new password cannot exceed 72 bytes\./);
    assert.match(adminChange, /strlen\(\$newPassword\) < SystemConfig::getIntValue\('iMinPasswordLength'\)/);
    assert.match(adminChange, /!\$this->getIsPasswordPermissible\(\$newPassword\)/);
    assertOrdered(adminChange, [
        "$connection->commit()",
        "$this->reload()",
        "$this->createTimeLineNote('password-changed-admin')",
    ]);
    assert.match(
        adminChange,
        /\$this->createTimeLineNote\('password-changed-admin'\)[\s\S]*catch \(\\Throwable \$exception\)/,
    );

    const selfChange = between(userModelSource, "public function userChangePassword", "private function getIsPasswordPermissible");
    assert.match(selfChange, /strlen\(\$newPassword\) > self::MAX_BCRYPT_PASSWORD_BYTES/);
    assert.match(selfChange, /Your new password cannot exceed 72 bytes\./);
    assert.match(
        selfChange,
        /\$this->createTimeLineNote\('password-changed'\)[\s\S]*catch \(\\Throwable \$exception\)[\s\S]*return \$newPasswordHash/,
    );
});

test("admin password changes validate both confirmation fields before updating the user", () => {
    const adminPasswordChange = between(
        adminSystemRouteSource,
        "function adminChangeUserPassword",
        "function adminUserEditorNew",
    );
    assert.match(adminPasswordChange, /AuthenticationManager::hasRecentSecurityActionAuthentication\(\)/);
    assert.match(adminPasswordChange, /AuthenticationManager::reauthenticateForSecurityAction\(\$loginRequestBody\['CurrentPassword'\]\)/);
    assert.match(adminPasswordChange, /isset\(\$loginRequestBody\['NewPassword1'\], \$loginRequestBody\['NewPassword2'\]\)/);
    assert.match(adminPasswordChange, /is_string\(\$loginRequestBody\['NewPassword1'\]\)/);
    assert.match(adminPasswordChange, /is_string\(\$loginRequestBody\['NewPassword2'\]\)/);
    assertOrdered(adminPasswordChange, [
        "AuthenticationManager::reauthenticateForSecurityAction($loginRequestBody['CurrentPassword'])",
        "hash_equals($loginRequestBody['NewPassword1'], $loginRequestBody['NewPassword2'])",
        "$user->adminSetUserPassword($loginRequestBody['NewPassword1'])",
        "AuthenticationManager::rotateAuthenticatedSessionAfterSecurityMutation()",
    ]);
});

test("security clients distinguish step-up, invalid-session, and expired-CSRF responses", () => {
    const twoFactorFailureHandler = between(
        twoFactorClientSource,
        "function handleSecurityActionFailure",
        "function executePendingSecurityAction",
    );
    assertOrdered(twoFactorFailureHandler, [
        "error.status === 428",
        "beginSecurityReauthentication(action, returnView)",
        "error.status === 401",
        "/session/begin",
        "error.status === 403",
        "This page's security token expired. Reload the page and try again.",
    ]);

    const apiKeyAction = between(apiKeyClientSource, "function executeApiKeyAction", '$("#revealApiKey")');
    assertOrdered(apiKeyAction, [
        "xhr.status === 428",
        "showApiKeyReauthentication(action)",
        "xhr.status === 401",
        "/session/begin",
        "xhr.status === 403",
        "This page's security token expired. Reload the page and try again.",
    ]);

    const adminAction = between(
        adminUserClientSource,
        "function adminUserSecurityRequest",
        "function deleteUser",
    );
    assert.match(
        adminAction,
        /jqXHR\.status === 428[\s\S]*jqXHR\.responseJSON\?\.code === "reauthentication_required"/,
    );
    assert.match(adminAction, /handleAdminUserSecurityRequestError\(jqXHR, textStatus, errorThrown\)/);
});

test("public API-key responses are non-cacheable", () => {
    const login = between(publicUserApiSource, "function userLogin", "function passwordResetRequest");
    assertOrdered(login, [
        "SlimUtils::renderJSON($response, ['apiKey' => $user->getApiKey()])",
        "->withHeader('Cache-Control', 'no-store, private')",
        "->withHeader('Pragma', 'no-cache')",
    ]);
});

test("public password-reset issuance uses the serialized user-row interface", () => {
    const resetRequest = between(publicUserApiSource, "function passwordResetRequest");
    assert.match(resetRequest, /\$token\s*=\s*\$user->issuePasswordResetToken\(\)/);
    assert.doesNotMatch(resetRequest, /new Token\s*\(/);
    assert.doesNotMatch(resetRequest, /->build\('password'/);
});
