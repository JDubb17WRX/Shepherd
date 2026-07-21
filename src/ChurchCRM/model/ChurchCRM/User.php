<?php

namespace ChurchCRM\model\ChurchCRM;

use ChurchCRM\Authentication\AuthenticationManager;
use ChurchCRM\Authentication\Exceptions\PasswordChangeException;
use ChurchCRM\dto\SystemConfig;
use ChurchCRM\Utils\KeyManagerUtils;
use ChurchCRM\model\ChurchCRM\Base\User as BaseUser;
use ChurchCRM\Utils\DateTimeUtils;
use ChurchCRM\Utils\LoggerUtils;
use ChurchCRM\Utils\MiscUtils;
use Defuse\Crypto\Crypto;
use PragmaRX\Google2FA\Google2FA;
use Propel\Runtime\Connection\ConnectionInterface;
use Propel\Runtime\Propel;

/**
 * Skeleton subclass for representing a row from the 'user_usr' table.
 *
 *
 *
 * You should add additional methods to this class to meet the
 * application requirements.  This class will only be generated as
 * long as it does not already exist in the output directory.
 */
class User extends BaseUser
{
    public const TWO_FACTOR_AUTHENTICATION_TOTP = 'totp';
    public const TWO_FACTOR_AUTHENTICATION_RECOVERY = 'recovery';
    public const TWO_FACTOR_AUTHENTICATION_INVALID = 'invalid';
    public const TWO_FACTOR_AUTHENTICATION_REVOKED = 'revoked';
    public const TWO_FACTOR_AUTHENTICATION_RATE_LIMITED = 'rate_limited';

    private const TWO_FACTOR_FAILURE_SETTING = 'security.2fa.failures';
    private const TWO_FACTOR_FAILURE_WINDOW_SECONDS = 600;
    private const MAX_TWO_FACTOR_FAILURES = 10;
    private const MAX_BCRYPT_PASSWORD_BYTES = 72;

    private ?string $provisional2FAKey = null;

    public function getId()
    {
        return $this->getPersonId();
    }

    public function getName(): string
    {
        return $this->getPerson()->getFullName();
    }

    public function getEmail(): ?string
    {
        return $this->getPerson()->getEmail();
    }

    public function getFullName(): string
    {
        return $this->getPerson()->getFullName();
    }

    // ── Consolidated Permission Checks ─────────────────────────────
    //
    // Every permission method follows the same contract:
    //   1. Admin users ALWAYS return true (admin bypasses everything).
    //   2. Non-admins need the specific per-user flag (from user_usr
    //      column or userconfig_ucfg row) AND, for module-gated
    //      permissions, the system-wide feature flag to be enabled.
    //
    // The naming convention is `isXxxEnabled()` for all permissions,
    // regardless of which storage layer backs the raw flag.
    //
    // See #8667, #8458 for the consolidation rationale.
    // ─────────────────────────────────────────────────────────────────

    // -- Per-user permissions (backed by user_usr columns) --
    //
    // EditSelf is an exclusive mode: when a non-admin user has EditSelf=1,
    // all module permissions (AddRecords, EditRecords, …, Notes, Finance) are
    // treated as false regardless of what is stored in the database, so every
    // consumer sees a consistent view.

    /**
     * True when the user is confined to the self-service flow.
     *
     * A non-admin user with EditSelf=1 has no module permissions and cannot use
     * the CRM interface — PageInit and AuthMiddleware redirect them to
     * /external/limited-access.
     *
     * Deliberately NOT true for a zero-permission user (all flags 0). Those users
     * retain read-only access to people and family records under the read-default
     * policy (#9003); writes are denied by the per-page and per-route permission
     * checks.
     */
    public function isEditSelfExclusive(): bool
    {
        return !$this->isAdmin() && $this->isEditSelf();
    }

    public function isAddRecordsEnabled(): bool
    {
        if ($this->isEditSelfExclusive()) {
            return false;
        }
        return $this->isAdmin() || $this->isAddRecords();
    }

    public function isEditRecordsEnabled(): bool
    {
        if ($this->isEditSelfExclusive()) {
            return false;
        }
        return $this->isAdmin() || $this->isEditRecords();
    }

    public function isDeleteRecordsEnabled(): bool
    {
        if ($this->isEditSelfExclusive()) {
            return false;
        }
        return $this->isAdmin() || $this->isDeleteRecords();
    }

    public function isMenuOptionsEnabled(): bool
    {
        if ($this->isEditSelfExclusive()) {
            return false;
        }
        return $this->isAdmin() || $this->isMenuOptions();
    }

    public function isManageGroupsEnabled(): bool
    {
        if ($this->isEditSelfExclusive()) {
            return false;
        }
        return $this->isAdmin() || $this->isManageGroups();
    }

    public function isNotesEnabled(): bool
    {
        if ($this->isEditSelfExclusive()) {
            return false;
        }
        return $this->isAdmin() || $this->isNotes();
    }

    public function isEditSelfEnabled(): bool
    {
        return $this->isAdmin() || $this->isEditSelf();
    }

    // -- Module-gated permissions (backed by userconfig_ucfg) --
    //    These additionally require a system-wide feature flag to be ON
    //    for non-admin users. Admins bypass the feature flag.

    public function isFinanceEnabled(): bool
    {
        if ($this->isEditSelfExclusive()) {
            return false;
        }
        return $this->isAdmin() || (SystemConfig::getBooleanValue('bEnabledFinance') && $this->isFinance());
    }

    public function isManageFundraisersEnabled(): bool
    {
        if ($this->isEditSelfExclusive()) {
            return false;
        }
        return $this->isAdmin() || (SystemConfig::getBooleanValue('bEnabledFundraiser') && $this->isManageFundraisers());
    }

    public function isAddEventEnabled(): bool
    {
        if ($this->isEditSelfExclusive()) {
            return false;
        }
        return $this->isAdmin() || $this->isEnabledSecurity('bAddEvent');
    }

    public function isEmailEnabled(): bool
    {
        if ($this->isEditSelfExclusive()) {
            return false;
        }
        return $this->isAdmin() || $this->isEnabledSecurity('bEmailMailto');
    }

    // -- Module view/manage permissions (combine feature flag + per-user) --

    public function canViewEvents(): bool
    {
        return $this->isAdmin() || self::isEventsEnabled();
    }

    public function canManageEvents(): bool
    {
        return $this->isAdmin() || (self::isEventsEnabled() && $this->isEnabledSecurity('bAddEvent'));
    }

    /**
     * Whether the Events module is enabled system-wide via SystemConfig.
     * Pure system check — no per-user permission gate.
     */
    public static function isEventsEnabled(): bool
    {
        return SystemConfig::getBooleanValue('bEnabledEvents');
    }

    // -- Consolidated permission map for API/UI consumption --

    /**
     * Return a structured map of all permissions for this user.
     * Useful for the user editor UI (/admin/system/users/{personId}/edit) and the user settings API.
     * Every value reflects the effective permission (with admin bypass applied).
     *
     * @return array<string, bool>
     */
    public function getAllPermissions(): array
    {
        return [
            // Core record permissions (user_usr columns)
            'isAdmin'             => $this->isAdmin(),
            'addRecords'          => $this->isAddRecordsEnabled(),
            'editRecords'         => $this->isEditRecordsEnabled(),
            'deleteRecords'       => $this->isDeleteRecordsEnabled(),
            'menuOptions'         => $this->isMenuOptionsEnabled(),
            'manageGroups'        => $this->isManageGroupsEnabled(),
            'finance'             => $this->isFinanceEnabled(),
            'manageFundraisers'   => $this->isManageFundraisersEnabled(),
            'notes'               => $this->isNotesEnabled(),
            'editSelf'            => $this->isEditSelfEnabled(),
            // Module permissions (userconfig_ucfg rows)
            'addEvent'            => $this->isAddEventEnabled(),
            'emailMailto'         => $this->isEmailEnabled(),
            // Computed module-level gates
            'canViewEvents'       => $this->canViewEvents(),
            'canManageEvents'     => $this->canManageEvents(),
        ];
    }

    /**
     * Check if the user lacks all functional admin permissions.
     * Users with no permissions (or only EditSelf) cannot use the admin interface
     * and should be redirected to a self-service flow or blocked.
     *
     * @see https://github.com/ChurchCRM/CRM/issues/8617
     */
    public function hasNoAdminPermissions(): bool
    {
        if ($this->isAdmin()) {
            return false;
        }
        if ($this->isEditSelf()) {
            // EditSelf is exclusive — no module permissions apply
            return true;
        }

        return !$this->isAddRecords()
            && !$this->isEditRecords()
            && !$this->isDeleteRecords()
            && !$this->isMenuOptions()
            && !$this->isManageGroups()
            && !$this->isFinance()
            && !$this->isManageFundraisers()
            && !$this->isNotes();
    }

    /**
     * Returns true if the current user may read basic metadata for any family.
     * All authenticated users have this capability by default (read-default policy).
     *
     * $familyId is reserved for future row-level security (e.g. pastoral-confidentiality
     * holds or per-family privacy flags). Pass the family ID at every call site so that
     * adding ABAC checks later requires no call-site changes.
     *
     * @param int $familyId The ID of the family to potentially read
     * @return bool True if user can read this family's record
     */
    public function canReadFamily(int $familyId = 0): bool
    {
        return true; // read is a default capability for all authenticated users
    }

    /**
     * Returns true if the current user may read basic metadata for any person.
     * All authenticated users have this capability by default (read-default policy).
     *
     * $personId is reserved for future row-level security (e.g. pastoral-confidentiality
     * holds or per-person privacy flags). Pass the person ID at every call site so that
     * adding ABAC checks later requires no call-site changes.
     *
     * @param int $personId The ID of the person to potentially read
     * @return bool True if user can read this person's record
     */
    public function canReadPerson(int $personId): bool
    {
        return true; // read is a default capability for all authenticated users
    }

    /**
     * Check if the user can edit a specific person's record.
     * Combines role-based (EditRecords) and object-level (EditSelf + family/own) authorization.
     *
     * @param int $personId The ID of the person to potentially edit
     * @param int $personFamilyId The family ID of the person (0 if no family)
     * @return bool True if user can edit this person's record
     */
    public function canEditPerson(int $personId, int $personFamilyId = 0): bool
    {
        // Users with EditRecords permission can edit anyone
        if ($this->isEditRecordsEnabled()) {
            return true;
        }

        // Users with EditSelf permission can edit their own record or family members
        if ($this->isEditSelfEnabled()) {
            // Can edit own record
            if ($personId === $this->getId()) {
                return true;
            }

            // Can edit family members (if person has a family)
            $person = $this->getPerson();
            if ($person === null) {
                return false; // orphaned user — deny access
            }
            if ($personFamilyId > 0 && $personFamilyId === (int) $person->getFamId()) {
                return true;
            }
        }

        return false;
    }

    /**
     * Check if the user can view/access a specific family's record.
     * All authenticated users can read any family by default (canReadFamily()).
     * EditSelf-only users are further restricted to their own family.
     *
     * @param int $familyId The ID of the family to potentially view
     * @return bool True if user can view this family's record
     */
    public function canViewFamily(int $familyId): bool
    {
        if ($this->isEditSelfEnabled() && !$this->isAdmin() && !$this->isEditRecordsEnabled()) {
            $person = $this->getPerson();
            if ($person === null) {
                return false;
            }
            return $familyId > 0 && $familyId === (int) $person->getFamId();
        }
        return true;
    }

    /**
     * Returns true if the current user may read non-private notes on the given object.
     * Requires the Notes role (or Admin via isNotesEnabled()).
     *
     * $personId / $familyId are reserved for future row-level security (e.g.
     * pastoral-confidentiality flags). Pass them at every call site so that
     * adding ABAC checks later requires no call-site changes.
     *
     * @param int|null $personId Reserved for future ABAC use
     * @param int|null $familyId Reserved for future ABAC use
     */
    public function canReadNotes(?int $personId = null, ?int $familyId = null): bool
    {
        return $this->isNotesEnabled();
    }

    /**
     * Returns true if the current user may read private notes authored by other users.
     *
     * Policy: admins may read any private note (full content visible in timeline,
     * API, and NoteEditor). Non-admin users may only read their own private notes;
     * that author-equality check is handled in Note::isVisibleTo(), so this method
     * governs only the "read someone else's private note" case.
     *
     * $personId / $familyId are reserved for future ABAC extensions (e.g. a future
     * per-record delegate granted read access to specific private notes).
     *
     * @param int|null $personId Reserved for future ABAC use
     * @param int|null $familyId Reserved for future ABAC use
     */
    public function canReadPrivateNotes(?int $personId = null, ?int $familyId = null): bool
    {
        return $this->isAdmin();
    }

    /**
     * Returns true if the current user may create a note on the given family.
     * Notes=1 or Admin currently grants cross-family write (intentional, see #9036/#9003).
     * Parameter is reserved as the ABAC hook for future per-family privacy holds.
     *
     * @param int|null $familyId Reserved for future ABAC use
     */
    public function canWriteNoteOnFamily(?int $familyId = null): bool
    {
        return $this->isNotesEnabled();
    }

    /**
     * Update password using secure bcrypt hashing.
     */
    public function updatePassword(string $password): void
    {
        $this->setPassword($this->hashPassword($password));
    }

    /**
     * Validate password against stored hash.
     * Supports bcrypt (current), legacy SHA-256 (6.x migration), and legacy MD5
     * (pre-6.x / ChurchInfo 1.x migration) formats.
     * On any legacy match, the stored hash is transparently upgraded to bcrypt.
     */
    public function isPasswordValid(string $password): bool
    {
        $verification = $this->verifyPasswordHash($password, $this->getPassword());
        if (!$verification['isValid']) {
            return false;
        }

        if ($verification['upgradedHash'] !== null) {
            $this->setPassword($verification['upgradedHash']);
            if ($verification['forcePasswordChange']) {
                $this->setNeedPasswordChange(true);
            }
            $this->save();
        }

        return true;
    }

    /**
     * @return array{isValid: bool, upgradedHash: ?string, forcePasswordChange: bool}
     */
    private function verifyPasswordHash(string $password, string $storedHash): array
    {
        // bcrypt ignores bytes after 72; reject overlong input so two distinct
        // passwords can never authenticate as the same credential.
        if (strlen($password) > self::MAX_BCRYPT_PASSWORD_BYTES) {
            return [
                'isValid' => false,
                'upgradedHash' => null,
                'forcePasswordChange' => false,
            ];
        }

        if ($this->isBcryptHash($storedHash)) {
            return [
                'isValid' => password_verify($password, $storedHash),
                'upgradedHash' => null,
                'forcePasswordChange' => false,
            ];
        }

        if ($this->isMd5Hash($storedHash) && hash_equals($storedHash, md5($password))) {
            return [
                'isValid' => true,
                'upgradedHash' => $this->hashPassword($password),
                'forcePasswordChange' => true,
            ];
        }

        if (hash_equals($storedHash, $this->legacyHashPassword($password))) {
            return [
                'isValid' => true,
                'upgradedHash' => $this->hashPassword($password),
                'forcePasswordChange' => false,
            ];
        }

        return [
            'isValid' => false,
            'upgradedHash' => null,
            'forcePasswordChange' => false,
        ];
    }

    /**
     * Hash password using bcrypt (PHP's password_hash with PASSWORD_DEFAULT).
     * This is the secure method for new passwords.
     */
    public function hashPassword(string $password): string
    {
        if (strlen($password) > self::MAX_BCRYPT_PASSWORD_BYTES) {
            throw new \InvalidArgumentException('Passwords cannot exceed 72 bytes when using bcrypt');
        }

        return password_hash($password, PASSWORD_DEFAULT);
    }

    /**
     * Legacy SHA-256 hashing for backward compatibility during migration.
     * @deprecated Will be removed in a future version
     */
    private function legacyHashPassword(string $password): string
    {
        return hash('sha256', $password . $this->getPersonId());
    }

    /**
     * Check if a hash is in bcrypt format.
     */
    private function isBcryptHash(string $hash): bool
    {
        return str_starts_with($hash, '$2y$') || str_starts_with($hash, '$2b$') || str_starts_with($hash, '$2a$');
    }

    /**
     * Check if a hash looks like an unsalted MD5 digest (32 lowercase hex chars).
     * Used during the ChurchInfo → ChurchCRM upgrade migration path.
     */
    private function isMd5Hash(string $hash): bool
    {
        return (bool) preg_match('/^[a-f0-9]{32}$/', $hash);
    }

    // isAddEvent() is kept as an alias for isAddEventEnabled() since it's
    // called by isEnabledSecurity('bAddEvent') checks elsewhere in the codebase
    public function isAddEvent(): bool
    {
        return $this->isAddEventEnabled();
    }

    public function isLocked(): bool
    {
        $maximumFailedLogins = self::getEffectiveMaximumFailedLogins();

        return $maximumFailedLogins > 0 && $this->getFailedLogins() >= $maximumFailedLogins;
    }

    /** The backing column is an unsigned TINYINT and cannot count past 255. */
    public static function getEffectiveMaximumFailedLogins(): int
    {
        $configuredMaximum = SystemConfig::getIntValue('iMaxFailedLogins');

        return $configuredMaximum > 0 ? min($configuredMaximum, 255) : 0;
    }

    /**
     * Serialize the lock check, password verification, and failure update for
     * one primary-authentication attempt. Requests that enter after the lock
     * threshold is reached never perform password verification.
     *
     * @return array{isPasswordValid: bool, isLocked: bool, accountBecameLocked: bool, passwordHash: ?string, twoFactorSecret: ?string, recoveryCodes: ?string}
     */
    public function authenticatePrimaryPassword(string $password): array
    {
        $maximumFailedLogins = self::getEffectiveMaximumFailedLogins();
        $connection = Propel::getWriteConnection('default');
        $transactionActive = false;
        try {
            $connection->beginTransaction();
            $transactionActive = true;
            $selectStatement = $connection->prepare(
                'SELECT usr_Password, usr_NeedPasswordChange, usr_FailedLogins, usr_TwoFactorAuthSecret, usr_TwoFactorAuthRecoveryCodes FROM user_usr WHERE usr_per_ID = ? FOR UPDATE'
            );
            $selectStatement->execute([$this->getPersonId()]);
            $storedUser = $selectStatement->fetch(\PDO::FETCH_ASSOC);
            if ($storedUser === false) {
                $connection->rollBack();
                $transactionActive = false;

                return [
                    'isPasswordValid' => false,
                    'isLocked' => true,
                    'accountBecameLocked' => false,
                    'passwordHash' => null,
                    'twoFactorSecret' => null,
                    'recoveryCodes' => null,
                ];
            }

            $previousFailedLogins = (int) $storedUser['usr_FailedLogins'];
            if ($maximumFailedLogins > 0 && $previousFailedLogins >= $maximumFailedLogins) {
                $connection->commit();
                $transactionActive = false;
                $this->setFailedLogins($previousFailedLogins);

                return [
                    'isPasswordValid' => false,
                    'isLocked' => true,
                    'accountBecameLocked' => false,
                    'passwordHash' => null,
                    'twoFactorSecret' => null,
                    'recoveryCodes' => null,
                ];
            }

            $verification = $this->verifyPasswordHash($password, $storedUser['usr_Password']);
            if ($verification['isValid']) {
                $needPasswordChange = (bool) $storedUser['usr_NeedPasswordChange'] || $verification['forcePasswordChange'];
                if ($verification['upgradedHash'] !== null) {
                    $upgradeStatement = $connection->prepare(
                        'UPDATE user_usr SET usr_Password = ?, usr_NeedPasswordChange = ? WHERE usr_per_ID = ?'
                    );
                    $upgradeStatement->execute([
                        $verification['upgradedHash'],
                        (int) $needPasswordChange,
                        $this->getPersonId(),
                    ]);
                }
                $connection->commit();
                $transactionActive = false;

                $this->setPassword($verification['upgradedHash'] ?? $storedUser['usr_Password']);
                $this->setNeedPasswordChange($needPasswordChange);
                $this->setFailedLogins($previousFailedLogins);

                return [
                    'isPasswordValid' => true,
                    'isLocked' => false,
                    'accountBecameLocked' => false,
                    'passwordHash' => $verification['upgradedHash'] ?? $storedUser['usr_Password'],
                    'twoFactorSecret' => $storedUser['usr_TwoFactorAuthSecret'],
                    'recoveryCodes' => $storedUser['usr_TwoFactorAuthRecoveryCodes'],
                ];
            }

            // usr_FailedLogins is an unsigned TINYINT; cap instead of overflowing.
            $updatedFailedLogins = min($previousFailedLogins + 1, 255);
            $updateStatement = $connection->prepare(
                'UPDATE user_usr SET usr_FailedLogins = ? WHERE usr_per_ID = ?'
            );
            $updateStatement->execute([$updatedFailedLogins, $this->getPersonId()]);
            $connection->commit();
            $transactionActive = false;
            $this->setFailedLogins($updatedFailedLogins);

            $accountBecameLocked = $maximumFailedLogins > 0
                && $previousFailedLogins < $maximumFailedLogins
                && $updatedFailedLogins >= $maximumFailedLogins;

            return [
                'isPasswordValid' => false,
                'isLocked' => $accountBecameLocked,
                'accountBecameLocked' => $accountBecameLocked,
                'passwordHash' => null,
                'twoFactorSecret' => null,
                'recoveryCodes' => null,
            ];
        } catch (\Throwable $exception) {
            if ($transactionActive) {
                $connection->rollBack();
            }
            throw $exception;
        }
    }

    /**
     * Atomically finish a successful authentication without overwriting a lock
     * that another primary attempt committed after password/factor validation.
     */
    public function finalizeSuccessfulAuthentication(
        string $expectedPasswordHash,
        ?string $expectedTwoFactorSecret,
        ?string $expectedRecoveryCodes,
        ?string $lastLogin = null
    ): bool
    {
        $maximumFailedLogins = self::getEffectiveMaximumFailedLogins();
        $connection = Propel::getWriteConnection('default');
        $transactionActive = false;
        try {
            $connection->beginTransaction();
            $transactionActive = true;
            $selectStatement = $connection->prepare(
                'SELECT usr_Password, usr_FailedLogins, usr_TwoFactorAuthSecret, usr_TwoFactorAuthRecoveryCodes FROM user_usr WHERE usr_per_ID = ? FOR UPDATE'
            );
            $selectStatement->execute([$this->getPersonId()]);
            $storedUser = $selectStatement->fetch(\PDO::FETCH_ASSOC);
            if ($storedUser === false) {
                $connection->rollBack();
                $transactionActive = false;

                return false;
            }

            if (!hash_equals($storedUser['usr_Password'], $expectedPasswordHash)) {
                $connection->commit();
                $transactionActive = false;

                return false;
            }

            $storedTwoFactorSecret = $storedUser['usr_TwoFactorAuthSecret'];
            $twoFactorStateMatches = $storedTwoFactorSecret === null
                ? $expectedTwoFactorSecret === null
                : $expectedTwoFactorSecret !== null && hash_equals($storedTwoFactorSecret, $expectedTwoFactorSecret);
            if (!$twoFactorStateMatches) {
                $connection->commit();
                $transactionActive = false;

                return false;
            }

            $storedRecoveryCodes = $storedUser['usr_TwoFactorAuthRecoveryCodes'];
            $recoveryStateMatches = $storedRecoveryCodes === null
                ? $expectedRecoveryCodes === null
                : $expectedRecoveryCodes !== null && hash_equals($storedRecoveryCodes, $expectedRecoveryCodes);
            if (!$recoveryStateMatches) {
                $connection->commit();
                $transactionActive = false;

                return false;
            }

            $failedLogins = (int) $storedUser['usr_FailedLogins'];
            if ($maximumFailedLogins > 0 && $failedLogins >= $maximumFailedLogins) {
                $connection->commit();
                $transactionActive = false;
                $this->setFailedLogins($failedLogins);

                return false;
            }

            if ($lastLogin === null) {
                $updateStatement = $connection->prepare(
                    'UPDATE user_usr SET usr_FailedLogins = 0 WHERE usr_per_ID = ?'
                );
                $updateStatement->execute([$this->getPersonId()]);
            } else {
                $updateStatement = $connection->prepare(
                    'UPDATE user_usr SET usr_LastLogin = ?, usr_LoginCount = LEAST(usr_LoginCount + 1, 65535), usr_FailedLogins = 0 WHERE usr_per_ID = ?'
                );
                $updateStatement->execute([$lastLogin, $this->getPersonId()]);
            }
            $clearFactorFailuresStatement = $connection->prepare(
                'DELETE FROM user_settings WHERE user_id = ? AND setting_name = ?'
            );
            $clearFactorFailuresStatement->execute([$this->getPersonId(), self::TWO_FACTOR_FAILURE_SETTING]);
            $connection->commit();
            $transactionActive = false;
        } catch (\Throwable $exception) {
            if ($transactionActive) {
                $connection->rollBack();
            }
            throw $exception;
        }

        // Clear any dirty legacy-hash or stale counter fields on this Propel
        // object so a later save cannot overwrite concurrent authentication state.
        $this->reload();

        return true;
    }

    public function resetPasswordToRandom(): string
    {
        $password = User::randomPassword();
        $passwordHash = $this->hashPassword($password);
        $connection = Propel::getWriteConnection('default');
        $transactionActive = false;
        try {
            $connection->beginTransaction();
            $transactionActive = true;
            $lockStatement = $connection->prepare(
                'SELECT usr_per_ID FROM user_usr WHERE usr_per_ID = ? FOR UPDATE'
            );
            $lockStatement->execute([$this->getPersonId()]);
            if ($lockStatement->fetchColumn() === false) {
                throw new \RuntimeException('Unable to reset password for a missing user');
            }

            $resetPasswordStatement = $connection->prepare(
                'UPDATE user_usr SET usr_Password = ?, usr_NeedPasswordChange = 1, usr_FailedLogins = 0, usr_apiKey = NULL WHERE usr_per_ID = ?'
            );
            $resetPasswordStatement->execute([$passwordHash, $this->getPersonId()]);
            $clearFactorFailuresStatement = $connection->prepare(
                'DELETE FROM user_settings WHERE user_id = ? AND setting_name = ?'
            );
            $clearFactorFailuresStatement->execute([$this->getPersonId(), self::TWO_FACTOR_FAILURE_SETTING]);
            $this->deletePasswordResetTokens($connection);
            $connection->commit();
            $transactionActive = false;
        } catch (\Throwable $exception) {
            if ($transactionActive) {
                $connection->rollBack();
            }
            throw $exception;
        }

        $this->reload();

        return $password;
    }

    /**
     * Issue a reset token while holding the same user-row lock used by token
     * consumption. This prevents a newly-issued token from slipping between
     * validation and account-wide sibling invalidation.
     */
    public function issuePasswordResetToken(): Token
    {
        $connection = Propel::getWriteConnection('default');
        $transactionActive = false;
        try {
            $connection->beginTransaction();
            $transactionActive = true;
            $lockStatement = $connection->prepare(
                'SELECT usr_per_ID FROM user_usr WHERE usr_per_ID = ? FOR UPDATE'
            );
            $lockStatement->execute([$this->getPersonId()]);
            if ($lockStatement->fetchColumn() === false) {
                throw new \RuntimeException('Unable to issue a reset token for a missing user');
            }

            // Only the newest delivered reset link remains usable.
            $this->deletePasswordResetTokens($connection);
            $token = new Token();
            $token->build('password', $this->getPersonId());
            $token->save($connection);
            $connection->commit();
            $transactionActive = false;

            return $token;
        } catch (\Throwable $exception) {
            if ($transactionActive) {
                $connection->rollBack();
            }
            throw $exception;
        }
    }

    /**
     * Atomically claim an exact, live reset token, invalidate every sibling,
     * and rotate the account credentials under one user-row lock.
     */
    public function resetPasswordWithToken(string $tokenValue): ?string
    {
        if ($tokenValue === '') {
            return null;
        }

        // Generate and hash before the transaction so local entropy/hash
        // failures do not consume a valid reset link.
        $password = self::randomPassword();
        $passwordHash = $this->hashPassword($password);
        $connection = Propel::getWriteConnection('default');
        $transactionActive = false;
        try {
            $connection->beginTransaction();
            $transactionActive = true;
            $lockStatement = $connection->prepare(
                'SELECT usr_per_ID FROM user_usr WHERE usr_per_ID = ? FOR UPDATE'
            );
            $lockStatement->execute([$this->getPersonId()]);
            if ($lockStatement->fetchColumn() === false) {
                throw new \RuntimeException('Unable to reset password for a missing user');
            }

            $tokenStatement = $connection->prepare(
                "SELECT token FROM tokens
                 WHERE token = ? AND type = 'password' AND reference_id = ?
                   AND remainingUses > 0 AND valid_until_date > ?
                 FOR UPDATE"
            );
            $tokenStatement->execute([
                $tokenValue,
                $this->getPersonId(),
                DateTimeUtils::getToday()->format('Y-m-d H:i:s'),
            ]);
            if ($tokenStatement->fetchColumn() === false) {
                $connection->rollBack();
                $transactionActive = false;

                return null;
            }

            $this->deletePasswordResetTokens($connection);
            $resetPasswordStatement = $connection->prepare(
                'UPDATE user_usr SET usr_Password = ?, usr_NeedPasswordChange = 1, usr_FailedLogins = 0, usr_apiKey = NULL WHERE usr_per_ID = ?'
            );
            $resetPasswordStatement->execute([$passwordHash, $this->getPersonId()]);
            $clearFactorFailuresStatement = $connection->prepare(
                'DELETE FROM user_settings WHERE user_id = ? AND setting_name = ?'
            );
            $clearFactorFailuresStatement->execute([$this->getPersonId(), self::TWO_FACTOR_FAILURE_SETTING]);
            $connection->commit();
            $transactionActive = false;
        } catch (\Throwable $exception) {
            if ($transactionActive) {
                $connection->rollBack();
            }
            throw $exception;
        }

        $this->reload();

        return $password;
    }

    private function deletePasswordResetTokens(ConnectionInterface $connection): void
    {
        $deleteTokensStatement = $connection->prepare(
            "DELETE FROM tokens WHERE type = 'password' AND reference_id = ?"
        );
        $deleteTokensStatement->execute([$this->getPersonId()]);
    }

    public static function randomPassword(): string
    {
        $alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890';
        $pass = []; //remember to declare $pass as an array
        $alphaLength = strlen($alphabet) - 1; //put the length -1 in cache
        for ($i = 0; $i < SystemConfig::getIntValue('iMinPasswordLength'); $i++) {
            $n = random_int(0, $alphaLength);
            $pass[] = $alphabet[$n];
        }

        return implode('', $pass); //turn the array into a string
    }

    public static function randomApiKey(): string
    {
        return MiscUtils::randomToken();
    }

    /** Atomically rotate an API key only if the caller observed current state. */
    public function regenerateApiKeyIfCurrent(?string $expectedApiKey): ?string
    {
        $connection = Propel::getWriteConnection('default');
        $transactionActive = false;
        try {
            $connection->beginTransaction();
            $transactionActive = true;
            $lockStatement = $connection->prepare(
                'SELECT usr_apiKey FROM user_usr WHERE usr_per_ID = ? FOR UPDATE'
            );
            $lockStatement->execute([$this->getPersonId()]);
            $storedApiKey = $lockStatement->fetchColumn();
            if ($storedApiKey === false) {
                throw new \RuntimeException('Unable to rotate API key for a missing user');
            }

            $stateMatches = $storedApiKey === null
                ? $expectedApiKey === null
                : $expectedApiKey !== null && hash_equals($storedApiKey, $expectedApiKey);
            if (!$stateMatches) {
                $connection->commit();
                $transactionActive = false;

                return null;
            }

            $newApiKey = self::randomApiKey();
            $updateStatement = $connection->prepare(
                'UPDATE user_usr SET usr_apiKey = ? WHERE usr_per_ID = ?'
            );
            $updateStatement->execute([$newApiKey, $this->getPersonId()]);
            $connection->commit();
            $transactionActive = false;
        } catch (\Throwable $exception) {
            if ($transactionActive) {
                $connection->rollBack();
            }
            throw $exception;
        }

        $this->reload();

        return $newApiKey;
    }

    public function postInsert(ConnectionInterface $con = null): void
    {
        $this->createTimeLineNote('created');
    }

    public function postDelete(ConnectionInterface $con = null): void
    {
        $this->createTimeLineNote('deleted');
    }

    public function createTimeLineNote($type): void
    {
        $note = new Note();
        $note->setPerId($this->getPersonId());
        $note->setEntered(AuthenticationManager::getCurrentUser()->getId());
        $note->setType('user');

        switch ($type) {
            case 'created':
                $note->setText(gettext('system user created'));
                break;
            case 'updated':
                $note->setText(gettext('system user updated'));
                break;
            case 'deleted':
                $note->setText(gettext('system user deleted'));
                break;
            case 'password-reset':
                $note->setText(gettext('system user password reset'));
                break;
            case 'password-changed':
                $note->setText(gettext('system user changed password'));
                break;
            case 'password-changed-admin':
                $note->setText(gettext('system user password changed by admin'));
                break;
            case 'api-key-regen':
                $note->setText(gettext('system user API key regenerated'));
                break;
            case 'login-reset':
                $note->setText(gettext('system user login reset'));
                break;
        }

        $note->save();
    }

    public function isEnabledSecurity($securityConfigName): bool
    {
        if ($this->isAdmin()) {
            return true;
        } elseif ($securityConfigName == 'bAdmin') {
            return false;
        }

        if ($securityConfigName == 'bAll') {
            return true;
        }

        if ($securityConfigName == 'bAddRecords' && $this->isAddRecordsEnabled()) {
            return true;
        }

        if ($securityConfigName == 'bEditRecords' && $this->isEditRecordsEnabled()) {
            return true;
        }

        if ($securityConfigName == 'bDeleteRecords' && $this->isDeleteRecordsEnabled()) {
            return true;
        }

        if ($securityConfigName == 'bManageGroups' && $this->isManageGroupsEnabled()) {
            return true;
        }

        if ($securityConfigName == 'bFinance' && $this->isFinanceEnabled()) {
            return true;
        }

        if ($securityConfigName == 'bNotes' && $this->isNotesEnabled()) {
            return true;
        }

        foreach ($this->getUserConfigs() as $userConfig) {
            if ($userConfig->getName() == $securityConfigName) {
                return $userConfig->getPermission() == 'TRUE';
            }
        }

        return false;
    }

    public function getUserConfigString($userConfigName)
    {
        foreach ($this->getUserConfigs() as $userConfig) {
            if ($userConfig->getName() == $userConfigName) {
                return $userConfig->getValue();
            }
        }
    }

    public function setUserConfigString($userConfigName, $value)
    {
        foreach ($this->getUserConfigs() as $userConfig) {
            if ($userConfig->getName() == $userConfigName) {
                return $userConfig->setValue($value);
            }
        }
    }

    public function setSetting($name, $value): void
    {
        $setting = $this->getSetting($name);
        if (!$setting) {
            $setting = new UserSetting();
            $setting->set($this, $name, $value);
        } else {
            $setting->setValue($value);
        }
        $setting->save();
    }

    public function getSettingValue($name)
    {
        $userSetting = $this->getSetting($name);

        return $userSetting === null ? '' : $userSetting->getValue();
    }

    public function getSetting($name)
    {
        foreach ($this->getUserSettings() as $userSetting) {
            if ($userSetting->getName() == $name) {
                return $userSetting;
            }
        }

        return null;
    }

    public function getStyle(): string
    {
        $skin = $this->getSetting(UserSetting::UI_STYLE) ?? 'skin-red';
        $cssClasses = [];
        $cssClasses[] = $skin;
        $cssClasses[] = $this->getSetting(UserSetting::UI_BOXED);
        $cssClasses[] = $this->getSetting(UserSetting::UI_SIDEBAR);

        return implode(' ', $cssClasses);
    }

    public function isShowPledges(): bool
    {
        return $this->getSettingValue(UserSetting::FINANCE_SHOW_PLEDGES) === 'true';
    }

    public function isShowPayments(): bool
    {
        return $this->getSettingValue(UserSetting::FINANCE_SHOW_PAYMENTS) === 'true';
    }

    public function getShowSince()
    {
        return $this->getSettingValue(UserSetting::FINANCE_SHOW_SINCE);
    }

    /**
     * Generates a new 2FA secret key for enrollment.
     * Uses pragmarx/google2fa v9.0+ default: 32-character secrets (160-bit entropy).
     * usr_TwoFactorAuthSecret (VARCHAR 255) supports both legacy 16-char and new 32-char secrets.
     *
     * @return string Base32-encoded TOTP secret
     */
    public function provisionNew2FAKey(): string
    {
        $google2fa = new Google2FA();
        $key = $google2fa->generateSecretKey();
        // store the temporary 2FA key in a private variable on this User object
        // we don't want to update the database with the new key until we've confirmed
        // that the user is capable of generating valid 2FA codes
        // encrypt the 2FA key since this object and its properties are serialized into the $_SESSION store
        // which is generally written to disk.
        $this->provisional2FAKey = Crypto::encryptWithPassword($key, KeyManagerUtils::getTwoFASecretKey());

        return $key;
    }

    public function clearProvisional2FAKey(): void
    {
        $this->provisional2FAKey = null;
    }

    public function confirmProvisional2FACode(
        string $twoFACode,
        string $expectedPasswordHash,
        ?string $expectedTwoFactorSecret
    ): ?string
    {
        if ($this->provisional2FAKey === null || $this->provisional2FAKey === '') {
            return null;
        }

        $google2fa = new Google2FA();
        $window = 2;
        try {
            $pw = Crypto::decryptWithPassword($this->provisional2FAKey, KeyManagerUtils::getTwoFASecretKey());
        } catch (\Throwable $exception) {
            $this->clearProvisional2FAKey();

            return null;
        }
        $acceptedTimestamp = $google2fa->verifyKeyNewer($pw, $twoFACode, 0, $window);
        if ($acceptedTimestamp !== false) {
            $confirmedSecret = $this->provisional2FAKey;
            $stateWasReplaced = $this->replaceTwoFactorAuthenticationState(
                $confirmedSecret,
                (int) $acceptedTimestamp,
                $expectedPasswordHash,
                $expectedTwoFactorSecret,
                true
            );
            $this->clearProvisional2FAKey();

            return $stateWasReplaced ? $confirmedSecret : null;
        }

        return null;
    }

    public function remove2FAKey(
        string $expectedPasswordHash,
        ?string $expectedTwoFactorSecret
    ): bool
    {
        return $this->replaceTwoFactorAuthenticationState(
            null,
            null,
            $expectedPasswordHash,
            $expectedTwoFactorSecret,
            true
        );
    }

    public function disableTwoFactorAuthentication(): void
    {
        $this->replaceTwoFactorAuthenticationState(null);
    }

    /**
     * Replace enrollment state and clear the shared factor limiter while
     * holding the user-row -> settings-row lock order used by factor auth.
     * Self-service callers use compare-and-swap markers; privileged admin
     * disablement deliberately performs an unconditional replacement.
     */
    private function replaceTwoFactorAuthenticationState(
        ?string $encryptedSecret,
        ?int $lastAcceptedTimestamp = null,
        ?string $expectedPasswordHash = null,
        ?string $expectedTwoFactorSecret = null,
        bool $requireExpectedState = false
    ): bool
    {
        $connection = Propel::getWriteConnection('default');
        $transactionActive = false;
        try {
            $connection->beginTransaction();
            $transactionActive = true;
            $lockStatement = $connection->prepare(
                'SELECT usr_Password, usr_TwoFactorAuthSecret FROM user_usr WHERE usr_per_ID = ? FOR UPDATE'
            );
            $lockStatement->execute([$this->getPersonId()]);
            $storedUser = $lockStatement->fetch(\PDO::FETCH_ASSOC);
            if ($storedUser === false) {
                throw new \RuntimeException('Unable to update two-factor state for a missing user');
            }

            $storedSecret = $storedUser['usr_TwoFactorAuthSecret'];
            $passwordStateMatches = $expectedPasswordHash !== null
                && hash_equals($storedUser['usr_Password'], $expectedPasswordHash);
            $twoFactorStateMatches = $storedSecret === null
                ? $expectedTwoFactorSecret === null
                : $expectedTwoFactorSecret !== null
                    && hash_equals($storedSecret, $expectedTwoFactorSecret);
            if ($requireExpectedState && (!$passwordStateMatches || !$twoFactorStateMatches)) {
                $connection->commit();
                $transactionActive = false;

                return false;
            }

            $updateStatement = $connection->prepare(
                <<<'SQL'
                    UPDATE user_usr
                    SET usr_TwoFactorAuthSecret = ?,
                        usr_TwoFactorAuthRecoveryCodes = NULL,
                        usr_TwoFactorAuthLastKeyTimestamp = ?
                    WHERE usr_per_ID = ?
                    SQL
            );
            $updateStatement->execute([$encryptedSecret, $lastAcceptedTimestamp, $this->getPersonId()]);
            $clearFailuresStatement = $connection->prepare(
                'DELETE FROM user_settings WHERE user_id = ? AND setting_name = ?'
            );
            $clearFailuresStatement->execute([$this->getPersonId(), self::TWO_FACTOR_FAILURE_SETTING]);
            $connection->commit();
            $transactionActive = false;
        } catch (\Throwable $exception) {
            if ($transactionActive) {
                $connection->rollBack();
            }
            throw $exception;
        }

        $this->reload();

        return true;
    }

    public function is2FactorAuthEnabled(): bool
    {
        return !empty($this->getTwoFactorAuthSecret());
    }

    public function isApiAuthenticationEligible(?bool $twoFactorAuthenticationEnabled = null): bool
    {
        if ($this->isLocked() || $this->getNeedPasswordChange()) {
            return false;
        }

        $mustEnrollInTwoFactorAuthentication = SystemConfig::getBooleanValue('bRequire2FA') || $this->isAdmin();

        $twoFactorAuthenticationEnabled ??= $this->is2FactorAuthEnabled();

        return !$mustEnrollInTwoFactorAuthentication || $twoFactorAuthenticationEnabled;
    }

    /**
     * Reserve a factor attempt while the caller holds the user row lock.
     * Returns the count written in the caller's still-open transaction.
     */
    private function reserveTwoFactorAuthAttempt(ConnectionInterface $connection): int
    {
        $statement = $connection->prepare(
            <<<'SQL'
                INSERT INTO user_settings (user_id, setting_name, setting_value)
                VALUES (?, ?, CONCAT('1:', UNIX_TIMESTAMP()))
                ON DUPLICATE KEY UPDATE setting_value = CASE
                    WHEN setting_value IS NULL
                        OR setting_value NOT REGEXP '^[0-9]+:[0-9]+$'
                        OR CAST(SUBSTRING_INDEX(setting_value, ':', -1) AS UNSIGNED) > UNIX_TIMESTAMP()
                        OR CAST(SUBSTRING_INDEX(setting_value, ':', -1) AS UNSIGNED) <= UNIX_TIMESTAMP() - CAST(? AS UNSIGNED)
                        THEN CONCAT('1:', UNIX_TIMESTAMP())
                    ELSE CONCAT(
                        LEAST(CAST(SUBSTRING_INDEX(setting_value, ':', 1) AS UNSIGNED) + 1, CAST(? AS UNSIGNED)),
                        ':',
                        SUBSTRING_INDEX(setting_value, ':', -1)
                    )
                END
                SQL
        );
        $statement->execute([
            $this->getPersonId(),
            self::TWO_FACTOR_FAILURE_SETTING,
            self::TWO_FACTOR_FAILURE_WINDOW_SECONDS,
            self::MAX_TWO_FACTOR_FAILURES + 1,
        ]);

        return $this->getStoredTwoFactorAuthAttemptCount($connection);
    }

    public function isTwoFactorAuthRateLimited(): bool
    {
        return $this->getTwoFactorAuthAttemptCount() >= self::MAX_TWO_FACTOR_FAILURES;
    }

    private function getTwoFactorAuthAttemptCount(): int
    {
        $connection = Propel::getConnection();
        $statement = $connection->prepare(
            <<<'SQL'
                SELECT CASE
                    WHEN setting_value IS NOT NULL
                        AND setting_value REGEXP '^[0-9]+:[0-9]+$'
                        AND CAST(SUBSTRING_INDEX(setting_value, ':', -1) AS UNSIGNED) <= UNIX_TIMESTAMP()
                        AND CAST(SUBSTRING_INDEX(setting_value, ':', -1) AS UNSIGNED) > UNIX_TIMESTAMP() - CAST(? AS UNSIGNED)
                        THEN CAST(SUBSTRING_INDEX(setting_value, ':', 1) AS UNSIGNED)
                    ELSE 0
                END
                FROM user_settings
                WHERE user_id = ?
                    AND setting_name = ?
                SQL
        );
        $statement->execute([
            self::TWO_FACTOR_FAILURE_WINDOW_SECONDS,
            $this->getPersonId(),
            self::TWO_FACTOR_FAILURE_SETTING,
        ]);

        return (int) ($statement->fetchColumn() ?: 0);
    }

    /**
     * Read the count written by reserveTwoFactorAuthAttempt without applying
     * expiry a second time. The upsert is the single expiry-normalization point,
     * which prevents a boundary-time cleanup from erasing a concurrent increment.
     */
    private function getStoredTwoFactorAuthAttemptCount(ConnectionInterface $connection): int
    {
        $statement = $connection->prepare(
            <<<'SQL'
                SELECT CAST(SUBSTRING_INDEX(setting_value, ':', 1) AS UNSIGNED)
                FROM user_settings
                WHERE user_id = ?
                    AND setting_name = ?
                SQL
        );
        $statement->execute([
            $this->getPersonId(),
            self::TWO_FACTOR_FAILURE_SETTING,
        ]);

        return (int) ($statement->fetchColumn() ?: 0);
    }

    /** Atomically clear both password and factor failure state. */
    public function resetAuthenticationFailures(): void
    {
        $connection = Propel::getWriteConnection('default');
        $transactionActive = false;
        try {
            $connection->beginTransaction();
            $transactionActive = true;
            $lockStatement = $connection->prepare(
                'SELECT usr_per_ID FROM user_usr WHERE usr_per_ID = ? FOR UPDATE'
            );
            $lockStatement->execute([$this->getPersonId()]);
            if ($lockStatement->fetchColumn() === false) {
                throw new \RuntimeException('Unable to reset authentication failures for a missing user');
            }

            $resetPasswordFailuresStatement = $connection->prepare(
                'UPDATE user_usr SET usr_FailedLogins = 0 WHERE usr_per_ID = ?'
            );
            $resetPasswordFailuresStatement->execute([$this->getPersonId()]);
            $clearFactorFailuresStatement = $connection->prepare(
                'DELETE FROM user_settings WHERE user_id = ? AND setting_name = ?'
            );
            $clearFactorFailuresStatement->execute([$this->getPersonId(), self::TWO_FACTOR_FAILURE_SETTING]);
            $connection->commit();
            $transactionActive = false;
        } catch (\Throwable $exception) {
            if ($transactionActive) {
                $connection->rollBack();
            }
            throw $exception;
        }

        $this->reload();
    }

    public function getNewTwoFARecoveryCodes(
        string $expectedPasswordHash,
        ?string $expectedTwoFactorSecret
    ): ?array
    {
        $expectedRecoveryCodes = $this->getTwoFactorAuthRecoveryCodes();
        // generate 12 human-readable recovery codes formatted as xxxxxxxx-xxxxxxxx (lowercase hex, 64 bits of entropy each)
        // and store as an encrypted, comma-separated list
        $recoveryCodes = [];
        for ($i = 0; $i < 12; $i++) {
            // random_bytes(8) yields 16 hex characters; split into two 8-char segments for xxxxxxxx-xxxxxxxx format
            $hex = bin2hex(random_bytes(8));
            $recoveryCodes[$i] = substr($hex, 0, 8) . '-' . substr($hex, 8, 8);
        }
        $recoveryCodesString = implode(',', $recoveryCodes);
        $encryptedRecoveryCodes = Crypto::encryptWithPassword($recoveryCodesString, KeyManagerUtils::getTwoFASecretKey());
        $connection = Propel::getWriteConnection('default');
        $transactionActive = false;
        try {
            $connection->beginTransaction();
            $transactionActive = true;
            $lockStatement = $connection->prepare(
                'SELECT usr_Password, usr_TwoFactorAuthSecret, usr_TwoFactorAuthRecoveryCodes FROM user_usr WHERE usr_per_ID = ? FOR UPDATE'
            );
            $lockStatement->execute([$this->getPersonId()]);
            $storedUser = $lockStatement->fetch(\PDO::FETCH_ASSOC);
            $storedSecret = $storedUser['usr_TwoFactorAuthSecret'] ?? null;
            $passwordStateMatches = $storedUser !== false
                && hash_equals($storedUser['usr_Password'], $expectedPasswordHash);
            $twoFactorStateMatches = $storedSecret !== null
                && $expectedTwoFactorSecret !== null
                && hash_equals($storedSecret, $expectedTwoFactorSecret);
            $storedRecoveryCodes = $storedUser['usr_TwoFactorAuthRecoveryCodes'] ?? null;
            $recoveryStateMatches = $storedRecoveryCodes === null
                ? $expectedRecoveryCodes === null
                : $expectedRecoveryCodes !== null
                    && hash_equals($storedRecoveryCodes, $expectedRecoveryCodes);
            if (!$passwordStateMatches || !$twoFactorStateMatches || !$recoveryStateMatches) {
                $connection->commit();
                $transactionActive = false;

                return null;
            }

            $updateStatement = $connection->prepare(
                'UPDATE user_usr SET usr_TwoFactorAuthRecoveryCodes = ? WHERE usr_per_ID = ?'
            );
            $updateStatement->execute([$encryptedRecoveryCodes, $this->getPersonId()]);
            $connection->commit();
            $transactionActive = false;
        } catch (\Throwable $exception) {
            if ($transactionActive) {
                $connection->rollBack();
            }
            throw $exception;
        }

        $this->reload();

        return $recoveryCodes;
    }

    /**
     * Atomically verify the primary-auth markers, reserve the shared factor
     * attempt, and consume either a TOTP timestamp or recovery code.
     */
    public function authenticateTwoFactorCode(
        string $twoFactorCode,
        string $expectedPasswordHash,
        string $expectedTwoFactorSecret
    ): string {
        $connection = Propel::getWriteConnection('default');
        $transactionActive = false;
        try {
            $connection->beginTransaction();
            $transactionActive = true;
            $selectStatement = $connection->prepare(
                <<<'SQL'
                    SELECT usr_Password, usr_FailedLogins, usr_TwoFactorAuthSecret,
                        usr_TwoFactorAuthLastKeyTimestamp, usr_TwoFactorAuthRecoveryCodes
                    FROM user_usr
                    WHERE usr_per_ID = ?
                    FOR UPDATE
                    SQL
            );
            $selectStatement->execute([$this->getPersonId()]);
            $storedUser = $selectStatement->fetch(\PDO::FETCH_ASSOC);
            $storedSecret = $storedUser['usr_TwoFactorAuthSecret'] ?? null;
            $maximumFailedLogins = self::getEffectiveMaximumFailedLogins();
            $accountIsLocked = $maximumFailedLogins > 0
                && (int) ($storedUser['usr_FailedLogins'] ?? $maximumFailedLogins) >= $maximumFailedLogins;
            if ($storedUser === false
                || $accountIsLocked
                || !hash_equals($storedUser['usr_Password'], $expectedPasswordHash)
                || $storedSecret === null
                || !hash_equals($storedSecret, $expectedTwoFactorSecret)) {
                $connection->commit();
                $transactionActive = false;

                return self::TWO_FACTOR_AUTHENTICATION_REVOKED;
            }

            $attemptCount = $this->reserveTwoFactorAuthAttempt($connection);
            if ($attemptCount > self::MAX_TWO_FACTOR_FAILURES) {
                $connection->commit();
                $transactionActive = false;

                return self::TWO_FACTOR_AUTHENTICATION_RATE_LIMITED;
            }

            if ($twoFactorCode === '') {
                $connection->commit();
                $transactionActive = false;

                return self::TWO_FACTOR_AUTHENTICATION_INVALID;
            }

            try {
                $google2fa = new Google2FA();
                $timestamp = $google2fa->verifyKeyNewer(
                    Crypto::decryptWithPassword($storedSecret, KeyManagerUtils::getTwoFASecretKey()),
                    $twoFactorCode,
                    $storedUser['usr_TwoFactorAuthLastKeyTimestamp'] === null
                        ? 0
                        : (int) $storedUser['usr_TwoFactorAuthLastKeyTimestamp'],
                    2
                );
            } catch (\Throwable $validationError) {
                // Corrupt factor data is an invalid attempt, not a reason to
                // roll back the limiter reservation made above.
                $timestamp = false;
            }
            if ($timestamp !== false) {
                $updateStatement = $connection->prepare(
                    'UPDATE user_usr SET usr_TwoFactorAuthLastKeyTimestamp = ? WHERE usr_per_ID = ?'
                );
                $updateStatement->execute([$timestamp, $this->getPersonId()]);
                $connection->commit();
                $transactionActive = false;

                return self::TWO_FACTOR_AUTHENTICATION_TOTP;
            }

            $encryptedRecoveryCodes = $storedUser['usr_TwoFactorAuthRecoveryCodes'];
            if (!empty($encryptedRecoveryCodes)) {
                $newFormatRegex = '/^[a-f0-9]+-?[a-f0-9]+$/i';
                $inputIsNewFormat = (bool) preg_match($newFormatRegex, $twoFactorCode);
                $normalizedInput = str_replace(['-', ' '], '', strtolower($twoFactorCode));
                try {
                    $codes = array_values(array_filter(
                        explode(',', Crypto::decryptWithPassword($encryptedRecoveryCodes, KeyManagerUtils::getTwoFASecretKey())),
                        static fn (string $code): bool => $code !== ''
                    ));
                } catch (\Throwable $validationError) {
                    // Preserve the reserved attempt when encrypted recovery
                    // data is malformed, and treat the submitted code as invalid.
                    $codes = [];
                }
                foreach ($codes as $key => $code) {
                    $storedIsNewFormat = (bool) preg_match($newFormatRegex, $code);
                    $matches = $inputIsNewFormat && $storedIsNewFormat
                        ? str_replace(['-', ' '], '', strtolower($code)) === $normalizedInput
                        : hash_equals($code, $twoFactorCode);
                    if ($matches) {
                        unset($codes[$key]);
                        try {
                            $updatedRecoveryCodes = empty($codes)
                                ? null
                                : Crypto::encryptWithPassword(implode(',', $codes), KeyManagerUtils::getTwoFASecretKey());
                        } catch (\Throwable $validationError) {
                            $connection->commit();
                            $transactionActive = false;

                            return self::TWO_FACTOR_AUTHENTICATION_INVALID;
                        }
                        $updateStatement = $connection->prepare(
                            'UPDATE user_usr SET usr_TwoFactorAuthRecoveryCodes = ? WHERE usr_per_ID = ?'
                        );
                        $updateStatement->execute([$updatedRecoveryCodes, $this->getPersonId()]);
                        $connection->commit();
                        $transactionActive = false;
                        // Keep the in-memory marker aligned for the session that
                        // just authenticated by consuming this recovery code.
                        $this->reload();

                        return self::TWO_FACTOR_AUTHENTICATION_RECOVERY;
                    }
                }
            }

            $connection->commit();
            $transactionActive = false;

            return self::TWO_FACTOR_AUTHENTICATION_INVALID;
        } catch (\Throwable $exception) {
            if ($transactionActive) {
                $connection->rollBack();
            }

            return self::TWO_FACTOR_AUTHENTICATION_INVALID;
        }
    }

    public function adminSetUserPassword(string $newPassword): void
    {
        if ($newPassword === '') {
            throw new PasswordChangeException('New', gettext('The new password cannot be empty.'));
        }
        if (strlen($newPassword) > self::MAX_BCRYPT_PASSWORD_BYTES) {
            throw new PasswordChangeException('New', gettext('The new password cannot exceed 72 bytes.'));
        }
        if (strlen($newPassword) < SystemConfig::getIntValue('iMinPasswordLength')) {
            throw new PasswordChangeException(
                'New',
                gettext('The new password must be at least') . ' '
                    . SystemConfig::getIntValue('iMinPasswordLength') . ' '
                    . gettext('characters')
            );
        }
        if (!$this->getIsPasswordPermissible($newPassword)) {
            throw new PasswordChangeException('New', gettext('The new password is too obvious. Please choose something else.'));
        }

        $newPasswordHash = $this->hashPassword($newPassword);
        $connection = Propel::getWriteConnection('default');
        $transactionActive = false;
        try {
            $connection->beginTransaction();
            $transactionActive = true;
            $lockStatement = $connection->prepare(
                'SELECT usr_per_ID FROM user_usr WHERE usr_per_ID = ? FOR UPDATE'
            );
            $lockStatement->execute([$this->getPersonId()]);
            if ($lockStatement->fetchColumn() === false) {
                throw new \RuntimeException('Unable to change the password for a missing user');
            }

            $updateStatement = $connection->prepare(
                'UPDATE user_usr SET usr_Password = ?, usr_NeedPasswordChange = 0, usr_apiKey = NULL WHERE usr_per_ID = ?'
            );
            $updateStatement->execute([$newPasswordHash, $this->getPersonId()]);
            $this->deletePasswordResetTokens($connection);
            $connection->commit();
            $transactionActive = false;
        } catch (\Throwable $exception) {
            if ($transactionActive) {
                $connection->rollBack();
            }
            throw $exception;
        }

        $this->reload();
        try {
            $this->createTimeLineNote('password-changed-admin');
        } catch (\Throwable $exception) {
            // The credential commit is authoritative. Do not prevent the
            // controller from rotating the acting administrator's session.
            try {
                LoggerUtils::getAppLogger()->warning('Unable to record administrator password-change timeline note', [
                    'userId' => $this->getPersonId(),
                    'exception' => $exception,
                ]);
            } catch (\Throwable $loggingError) {
                // Continue the security-mutation completion path.
            }
        }
    }

    public function userChangePassword(
        string $oldPassword,
        string $newPassword,
        string $expectedPasswordHash,
        ?string $expectedTwoFactorSecret,
        ?string $expectedRecoveryCodes
    ): string
    {
        if (!$this->verifyPasswordHash($oldPassword, $expectedPasswordHash)['isValid']) {
            throw new PasswordChangeException('Old', gettext('Incorrect password supplied for current user'));
        }

        if (!$this->getIsPasswordPermissible($newPassword)) {
            throw new PasswordChangeException('New', gettext('Your password choice is too obvious. Please choose something else.'));
        }

        if (strlen($newPassword) > self::MAX_BCRYPT_PASSWORD_BYTES) {
            throw new PasswordChangeException('New', gettext('Your new password cannot exceed 72 bytes.'));
        }

        if (strlen($newPassword) < SystemConfig::getIntValue('iMinPasswordLength')) {
            throw new PasswordChangeException('New', gettext('Your new password must be at least') . ' ' . SystemConfig::getIntValue('iMinPasswordLength') . ' ' . gettext('characters'));
        }

        if ($newPassword == $oldPassword) {
            throw new PasswordChangeException('New', gettext('Your new password must not match your old one.'));
        }

        if (levenshtein(strtolower($newPassword), strtolower($oldPassword)) < SystemConfig::getIntValue('iMinPasswordChange')) {
            throw new PasswordChangeException('New', gettext('Your new password is too similar to your old one.'));
        }

        $newPasswordHash = $this->hashPassword($newPassword);
        $connection = Propel::getWriteConnection('default');
        $transactionActive = false;
        try {
            $connection->beginTransaction();
            $transactionActive = true;
            $lockStatement = $connection->prepare(
                'SELECT usr_Password, usr_TwoFactorAuthSecret, usr_TwoFactorAuthRecoveryCodes FROM user_usr WHERE usr_per_ID = ? FOR UPDATE'
            );
            $lockStatement->execute([$this->getPersonId()]);
            $storedUser = $lockStatement->fetch(\PDO::FETCH_ASSOC);
            $storedSecret = $storedUser['usr_TwoFactorAuthSecret'] ?? null;
            $passwordStateMatches = $storedUser !== false
                && hash_equals($storedUser['usr_Password'], $expectedPasswordHash);
            $twoFactorStateMatches = $storedSecret === null
                ? $expectedTwoFactorSecret === null
                : $expectedTwoFactorSecret !== null
                    && hash_equals($storedSecret, $expectedTwoFactorSecret);
            $storedRecoveryCodes = $storedUser['usr_TwoFactorAuthRecoveryCodes'] ?? null;
            $recoveryStateMatches = $storedRecoveryCodes === null
                ? $expectedRecoveryCodes === null
                : $expectedRecoveryCodes !== null
                    && hash_equals($storedRecoveryCodes, $expectedRecoveryCodes);
            $oldPasswordIsCurrent = $storedUser !== false
                && $this->verifyPasswordHash($oldPassword, $storedUser['usr_Password'])['isValid'];
            if (!$passwordStateMatches || !$twoFactorStateMatches || !$recoveryStateMatches || !$oldPasswordIsCurrent) {
                $connection->rollBack();
                $transactionActive = false;
                throw new PasswordChangeException('Old', gettext('Incorrect password supplied for current user'));
            }

            $updateStatement = $connection->prepare(
                'UPDATE user_usr SET usr_Password = ?, usr_NeedPasswordChange = 0, usr_apiKey = NULL WHERE usr_per_ID = ?'
            );
            $updateStatement->execute([$newPasswordHash, $this->getPersonId()]);
            $this->deletePasswordResetTokens($connection);
            $connection->commit();
            $transactionActive = false;
        } catch (PasswordChangeException $exception) {
            throw $exception;
        } catch (\Throwable $exception) {
            if ($transactionActive) {
                $connection->rollBack();
            }
            throw $exception;
        }

        $this->reload();
        try {
            $this->createTimeLineNote('password-changed');
        } catch (\Throwable $exception) {
            // Let the caller synchronize credential markers and rotate the
            // acting session after the password commit.
            try {
                LoggerUtils::getAppLogger()->warning('Unable to record self-service password-change timeline note', [
                    'userId' => $this->getPersonId(),
                    'exception' => $exception,
                ]);
            } catch (\Throwable $loggingError) {
                // Continue the security-mutation completion path.
            }
        }

        return $newPasswordHash;
    }

    private function getIsPasswordPermissible($newPassword): bool
    {
        $aBadPasswords = explode(',', strtolower(SystemConfig::getValue('aDisallowedPasswords')));
        $aBadPasswords[] = strtolower($this->getPerson()->getFirstName());
        $aBadPasswords[] = strtolower($this->getPerson()->getMiddleName());
        $aBadPasswords[] = strtolower($this->getPerson()->getLastName());

        return !in_array(strtolower($newPassword), $aBadPasswords);
    }
}
