<?php

namespace ChurchCRM\Authentication;

use ChurchCRM\Authentication\AuthenticationProviders\APITokenAuthentication;
use ChurchCRM\Authentication\AuthenticationProviders\IAuthenticationProvider;
use ChurchCRM\Authentication\AuthenticationProviders\LocalAuthentication;
use ChurchCRM\Authentication\Requests\APITokenAuthenticationRequest;
use ChurchCRM\Authentication\Requests\AuthenticationRequest;
use ChurchCRM\Authentication\Requests\LocalTwoFactorTokenRequest;
use ChurchCRM\Authentication\Requests\LocalUsernamePasswordRequest;
use ChurchCRM\dto\SystemURLs;
use ChurchCRM\model\ChurchCRM\User;
use ChurchCRM\Service\NotificationService;
use ChurchCRM\Utils\ChurchCRMReleaseManager;
use ChurchCRM\Utils\LoggerUtils;
use ChurchCRM\Utils\RedirectUtils;

class AuthenticationManager
{
    // This class exists to abstract the implementations of various authentication providers
    // Currently, only local auth is implemented; hence the zero-indexed array elements.

    public static function getAuthenticationProvider(): IAuthenticationProvider
    {
        if (
            isset($_SESSION) &&
            array_key_exists('AuthenticationProvider', $_SESSION) &&
            $_SESSION['AuthenticationProvider'] instanceof IAuthenticationProvider
        ) {
            return $_SESSION['AuthenticationProvider'];
        } else {
            throw new \Exception('No active authentication provider');
        }
    }

    private static function setAuthenticationProvider(IAuthenticationProvider $AuthenticationProvider): void
    {
        $_SESSION['AuthenticationProvider'] = $AuthenticationProvider;
    }

    public static function getCurrentUser(): User
    {
        try {
            $currentUser = self::getAuthenticationProvider()->getCurrentUser();
            if (!$currentUser instanceof User) {
                $provider = self::getAuthenticationProvider();
                throw new \Exception('No current user provided by current authentication provider: ' . $provider::class);
            }

            return $currentUser;
        } catch (\Throwable $e) {
            LoggerUtils::getAppLogger()->debug('Failed to get current user', ['exception' => $e]);

            throw $e;
        }
    }

    /** Update only the current local session after its own password change. */
    public static function synchronizeAuthenticatedPasswordHash(string $expectedPasswordHash): void
    {
        $provider = self::getAuthenticationProvider();
        if ($provider instanceof LocalAuthentication) {
            $provider->synchronizeAuthenticatedPasswordHash($expectedPasswordHash);
        }
    }

    /** Update only the current local session after its own 2FA state change. */
    public static function synchronizeAuthenticatedTwoFactorSecret(?string $expectedTwoFactorSecret): void
    {
        $provider = self::getAuthenticationProvider();
        if ($provider instanceof LocalAuthentication) {
            $provider->synchronizeAuthenticatedTwoFactorSecret($expectedTwoFactorSecret);
        }
    }

    /** Update only the current local session after its recovery codes change. */
    public static function synchronizeAuthenticatedRecoveryCodes(?string $expectedRecoveryCodes): void
    {
        $provider = self::getAuthenticationProvider();
        if ($provider instanceof LocalAuthentication) {
            $provider->synchronizeAuthenticatedRecoveryCodes($expectedRecoveryCodes);
        }
    }

    /** Invalidate cloned copies of the current browser session after a credential mutation. */
    public static function rotateAuthenticatedSessionAfterSecurityMutation(): void
    {
        $provider = self::getAuthenticationProvider();
        if (!$provider instanceof LocalAuthentication) {
            throw new \LogicException('Security credential mutations require local browser authentication');
        }

        $provider->rotateAuthenticatedSessionAfterSecurityMutation();
    }

    /** @return array{passwordHash: string, twoFactorSecret: ?string, recoveryCodes: ?string} */
    public static function getAuthenticatedSecurityMarkers(): array
    {
        $provider = self::getAuthenticationProvider();
        if ($provider instanceof LocalAuthentication) {
            return $provider->getAuthenticatedSecurityMarkers();
        }

        $user = self::getCurrentUser();

        return [
            'passwordHash' => $user->getPassword(),
            'twoFactorSecret' => $user->getTwoFactorAuthSecret(),
            'recoveryCodes' => $user->getTwoFactorAuthRecoveryCodes(),
        ];
    }

    public static function isCompletedLocalAuthentication(): bool
    {
        try {
            $provider = self::getAuthenticationProvider();

            return $provider instanceof LocalAuthentication && $provider->isPrimaryAuthenticationComplete();
        } catch (\Throwable $exception) {
            return false;
        }
    }

    public static function hasRecentSecurityActionAuthentication(): bool
    {
        try {
            $provider = self::getAuthenticationProvider();

            return $provider instanceof LocalAuthentication
                && $provider->hasRecentSecurityActionAuthentication();
        } catch (\Throwable $exception) {
            return false;
        }
    }

    public static function reauthenticateForSecurityAction(string $password): bool
    {
        try {
            $provider = self::getAuthenticationProvider();

            return $provider instanceof LocalAuthentication
                && $provider->reauthenticateForSecurityAction($password);
        } catch (\Throwable $exception) {
            return false;
        }
    }

    public static function isUserAuthenticated(): bool
    {
        try {
            $provider = self::getAuthenticationProvider();

            // API keys are authenticated for the current request only; their
            // provider deliberately reports no reusable session.
            if ($provider instanceof APITokenAuthentication) {
                return $provider->getCurrentUser() instanceof User;
            }

            return $provider->validateUserSessionIsActive(false)->isAuthenticated;
        } catch (\Throwable $error) {
            return false;
        }
    }

    public static function endSession(bool $preventRedirect = false): void
    {
        $logger = null;
        try {
            $logger = LoggerUtils::getAuthLogger();
        } catch (\Throwable $error) {
            // Logging must never be a prerequisite for destroying a session.
        }
        $currentSessionUserName = 'Unknown';

        try {
            $currentSessionUserName = self::getCurrentUser()->getName();
        } catch (\Throwable $e) {
            //unable to get name of user logging out. Don't really care.
        }
        $logCtx = ['username' => $currentSessionUserName];

        try {
            self::getAuthenticationProvider()->endSession();
        } catch (\Throwable $e) {
            if ($logger !== null) {
                try {
                    $logger->warning(
                        'Error destroying session',
                        array_merge($logCtx, ['exception' => $e])
                    );
                } catch (\Throwable $loggingError) {
                    // Session destruction must continue even if logging fails.
                }
            }
        } finally {
            try {
                $_SESSION = [];
                session_unset();
            } catch (\Throwable $error) {
                if ($logger !== null) {
                    try {
                        $logger->warning(
                            'Error clearing PHP session data',
                            array_merge($logCtx, ['exception' => $error])
                        );
                    } catch (\Throwable $loggingError) {
                        // Continue to destroy session storage even if logging fails.
                    }
                }
            }
            try {
                if (session_status() === PHP_SESSION_ACTIVE) {
                    session_destroy();
                }
            } catch (\Throwable $error) {
                if ($logger !== null) {
                    try {
                        $logger->warning(
                            'Error destroying PHP session storage',
                            array_merge($logCtx, ['exception' => $error])
                        );
                    } catch (\Throwable $loggingError) {
                        // Redirect handling must not depend on logger availability.
                    }
                }
            }
            if ($logger !== null) {
                try {
                    $logger->info('Ended Local session for user', $logCtx);
                } catch (\Throwable $loggingError) {
                    // Logout has completed; do not let logging suppress redirect.
                }
            }
            if (!$preventRedirect) {
                RedirectUtils::redirect(self::getSessionBeginURL());
            }
        }
    }

    public static function authenticate(AuthenticationRequest $AuthenticationRequest): AuthenticationResult
    {
        $logger = LoggerUtils::getAppLogger();
        switch ($AuthenticationRequest::class) {
            case APITokenAuthenticationRequest::class:
                $AuthenticationProvider = new APITokenAuthentication();
                break;
            case LocalUsernamePasswordRequest::class:
                $AuthenticationProvider = new LocalAuthentication();
                break;
            case LocalTwoFactorTokenRequest::class:
                try {
                    $AuthenticationProvider = self::getAuthenticationProvider();
                } catch (\Exception $e) {
                    $logger->warning(
                        "Tried to supply two factor authentication code, but didn't have an existing session.  This shouldn't ever happen",
                        ['exception' => $e]
                    );
                    throw $e;
                }
                break;
            default:
                $logger->error('Unknown AuthenticationRequest type supplied', ['providedAuthenticationRequestClass' => $AuthenticationRequest::class]);
                throw new \Exception('Unknown authentication request type');
        }

        $result = $AuthenticationProvider->authenticate($AuthenticationRequest);

        // Persist provider state only after authenticate() has finished. Failed
        // primary authentication therefore replaces any prior provider with a
        // clean instance instead of serializing a candidate User pre-validation.
        self::setAuthenticationProvider($AuthenticationProvider);

        if (null !== $result->nextStepURL) {
            $logger->debug('Authentication requires additional step: ' . $result->nextStepURL);
            RedirectUtils::redirect($result->nextStepURL);
        }

        if ($result->isAuthenticated && !$result->preventRedirect) {
            $redirectLocation = self::validateRedirectPath($_SESSION['location'] ?? null);
            unset($_SESSION['location']); // clear post-login redirect (one-time use)
            $redirectLocation ??= 'v2/dashboard';
            
            // One-time login tasks: check for system updates and fetch remote notifications
            self::checkSystemUpdates();
            NotificationService::fetchRemoteNotifications();

            $logger->debug(
                'Authentication Successful; redirecting to: ' . $redirectLocation
            );
            RedirectUtils::redirect($redirectLocation);
        }

        return $result;
    }

    public static function validateUserSessionIsActive(bool $updateLastOperationTimestamp = true): bool
    {
        return self::getUserSessionValidationResult($updateLastOperationTimestamp)->isAuthenticated;
    }

    /**
     * Return the full session state so HTTP entry points can enforce required
     * authentication steps without discarding nextStepURL.
     */
    public static function getUserSessionValidationResult(bool $updateLastOperationTimestamp = true): AuthenticationResult
    {
        $authenticationResult = new AuthenticationResult();

        // Check if an authentication provider is set before attempting validation
        // This prevents unnecessary logging for public API calls that don't require authentication
        if (
            !isset($_SESSION) ||
            !array_key_exists('AuthenticationProvider', $_SESSION) ||
            !$_SESSION['AuthenticationProvider'] instanceof IAuthenticationProvider
        ) {
            return $authenticationResult;
        }

        try {
            return self::getAuthenticationProvider()
                ->validateUserSessionIsActive($updateLastOperationTimestamp);
        } catch (\Exception $error) {
            LoggerUtils::getAuthLogger()->debug(
                'Error determining session authentication status.',
                ['exception' => $error]
            );

            return $authenticationResult;
        }
    }

    public static function ensureAuthentication(): void
    {
        // This function differs from the semantic `ValidateUserSessionIsActive` in that it will
        // take corrective action to redirect the user to an appropriate login location
        // if the current session is not actually authenticated

        try {
            $result = self::getUserSessionValidationResult(true);
            // Auth providers will always include a `nextStepURL` if authentication fails.
            // Sometimes other actions may require a `nextStepURL` that should be enforced with
            // an authentication request (2FA, Expired Password, etc).
            if (null !== $result->nextStepURL) {
                LoggerUtils::getAuthLogger()->debug(
                    'Session requires an additional authentication step.'
                );
                RedirectUtils::redirect($result->nextStepURL);
            } elseif (!$result->isAuthenticated) {
                LoggerUtils::getAuthLogger()->debug(
                    'Session not authenticated.  Redirecting to login page'
                );

                // Store the originally requested URL in the session for post-login redirect.
                // Using the session (server-side) prevents open-redirect attacks via a crafted query parameter.
                $safeUri = RedirectUtils::stripAndValidatePath($_SERVER['REQUEST_URI'] ?? '');
                if ($safeUri !== '') {
                    $_SESSION['location'] = $safeUri;
                }
                RedirectUtils::redirect(self::getSessionBeginURL());
            }
            LoggerUtils::getAuthLogger()->debug('Session valid');
        } catch (\Throwable $error) {
            LoggerUtils::getAuthLogger()->debug(
                'Error determining session authentication status.  Redirecting to login page.',
                ['exception' => $error]
            );
            RedirectUtils::redirect(self::getSessionBeginURL());
        }
    }

    public static function getSessionBeginURL(): string
    {
        return SystemURLs::getRootPath() . '/session/begin';
    }

    public static function getForgotPasswordURL(): string
    {
        return SystemURLs::getRootPath() . '/session/forgot-password/reset-request';
    }
    public static function redirectHomeIfFalse(bool $hasAccess, string $missingRole = ''): void
    {
        if (!$hasAccess) {
            if ($missingRole !== '') {
                RedirectUtils::securityRedirect($missingRole);
            } else {
                RedirectUtils::redirect('v2/dashboard');
            }
        }
    }

    public static function redirectHomeIfNotAdmin(): void
    {
        if (!AuthenticationManager::getCurrentUser()->isAdmin()) {
            RedirectUtils::securityRedirect('Admin');
        }
    }

    /**
     * Validates a redirect URL and returns it, or null if it is invalid/empty.
     * Used to consolidate the validate-then-nullify pattern for post-login redirects.
     */
    private static function validateRedirectPath(?string $url): ?string
    {
        if (empty($url)) {
            return null;
        }
        $validated = RedirectUtils::validateRedirectUrl($url, '');

        return $validated !== '' ? $validated : null;
    }

    /**
     * Check for system updates and store result in session.
     * Only runs for admin users on login. The upgrade notification is
     * rendered on page load by NotificationService::loadSessionNotifications().
     */
    private static function checkSystemUpdates(): void
    {
        $currentUser = self::getCurrentUser();
        if (!$currentUser->isAdmin()) {
            $_SESSION['systemUpdateAvailable'] = false;
            $_SESSION['systemUpdateVersion'] = null;
            $_SESSION['systemLatestVersion'] = null;
            return;
        }

        $updateInfo = ChurchCRMReleaseManager::checkSystemUpdateAvailable();
        $_SESSION['systemUpdateAvailable'] = $updateInfo['available'];
        $_SESSION['systemUpdateVersion'] = $updateInfo['version'];
        $_SESSION['systemLatestVersion'] = $updateInfo['latestVersion'];
    }
}
