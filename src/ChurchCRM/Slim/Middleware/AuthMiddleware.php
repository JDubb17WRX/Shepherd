<?php

namespace ChurchCRM\Slim\Middleware;

use ChurchCRM\Authentication\AuthenticationManager;
use ChurchCRM\Authentication\Requests\APITokenAuthenticationRequest;
use ChurchCRM\dto\SystemURLs;
use ChurchCRM\Utils\LoggerUtils;
use ChurchCRM\Utils\RedirectUtils;
use Laminas\Diactoros\Response;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface;
use Psr\Http\Message\ResponseInterface;

class AuthMiddleware implements MiddlewareInterface
{
    use BrowserRequestTrait;

    public function process(ServerRequestInterface $request, RequestHandlerInterface $handler): ResponseInterface
    {
        // Construct the full public API path including any subdirectory installation
        // Examples: '/api/public' (root install), '/crm/api/public' (subdirectory install)
        $publicApiPath = SystemURLs::getRootPath() . '/api/public';
        
        if (!str_starts_with($request->getUri()->getPath(), $publicApiPath)) {
            $apiKey = $request->getHeader('x-api-key');
            if (!empty($apiKey)) {
                $logger = LoggerUtils::getAppLogger();
                $logger->debug('API key authentication attempt', [
                    'path' => $request->getUri()->getPath(),
                    'has_key' => !empty($apiKey[0])
                ]);
                $authenticationResult = AuthenticationManager::authenticate(new APITokenAuthenticationRequest($apiKey[0]));
                if (!$authenticationResult->isAuthenticated) {
                    try {
                        AuthenticationManager::endSession(true);
                    } catch (\Exception $e) {
                        $logger->debug('Error ending session during failed API auth', ['exception' => $e]);
                    }
                    $logger->warning('Invalid API key authentication attempt', [
                        'path' => $request->getUri()->getPath(),
                        'method' => $request->getMethod()
                    ]);
                    $response = new Response();
                    $errorBody = json_encode(['error' => gettext('Invalid API key'), 'code' => 401]);
                    $response->getBody()->write($errorBody);
                    return $response->withStatus(401)->withHeader('Content-Type', 'application/json');
                }
                $logger->debug('API key authentication successful', [
                    'path' => $request->getUri()->getPath()
                ]);

                // Confine EditSelf-only users to the self-service flow — they have no
                // module permissions and no business on the internal API surface.
                // Zero-permission users are NOT blocked: they retain read-only access
                // to people/family records (read-default policy, #9003). Writes are
                // denied by the per-route role middleware.
                $apiUser = AuthenticationManager::getCurrentUser();
                if ($apiUser->isEditSelfExclusive()) {
                    $response = new Response();
                    $response->getBody()->write(json_encode(['error' => 'Account has limited permissions. Contact an administrator.']));
                    return $response->withStatus(403)->withHeader('Content-Type', 'application/json');
                }
            } else {
                // validate the user session; however, do not update tLastOperation if the requested path is "/background"
                // since /background operations do not connotate user activity.
                $sessionValidation = AuthenticationManager::getUserSessionValidationResult(!$this->isPath($request, 'background'));
                $requiredStepRequestAllowed = $sessionValidation->nextStepURL !== null
                    && $this->isRequiredStepRequestAllowed($request, $sessionValidation->nextStepURL);

                if ($sessionValidation->nextStepURL !== null && !$requiredStepRequestAllowed) {
                    return $this->requiredStepResponse($request, $sessionValidation->nextStepURL, $sessionValidation->isAuthenticated);
                }

                if ($sessionValidation->isAuthenticated || $requiredStepRequestAllowed) {
                    // Confine EditSelf-only users to the self-service flow.
                    // BUT allow exact required-step requests through; otherwise the
                    // user cannot complete password change or mandatory 2FA enrollment.
                    $sessionUser = AuthenticationManager::getCurrentUser();
                    if ($sessionUser->isEditSelfExclusive() && !$requiredStepRequestAllowed && !$this->isAuthFlowExemptPath($request)) {
                        if ($this->isBrowserRequest($request)) {
                            $rootPath = SystemURLs::getRootPath();
                            return (new Response())->withStatus(302)->withHeader('Location', $rootPath . '/external/limited-access');
                        }
                        // API request — return 403
                        $response = new Response();
                        $response->getBody()->write(json_encode(['error' => 'Account has limited permissions. Contact an administrator.']));
                        return $response->withStatus(403)->withHeader('Content-Type', 'application/json');
                    }
                } else {
                    $logger = LoggerUtils::getAppLogger();
                    $logger->warning('No authenticated user or session', [
                        'path' => $request->getUri()->getPath(),
                        'method' => $request->getMethod()
                    ]);

                    // Check if this is a browser request - redirect to login instead of JSON error
                    if ($this->isBrowserRequest($request)) {
                        return $this->redirectToLogin($request);
                    }

                    $response = new Response();
                    $errorBody = json_encode(['error' => gettext('No logged in user'), 'code' => 401]);
                    $response->getBody()->write($errorBody);
                    return $response->withStatus(401)->withHeader('Content-Type', 'application/json');
                }
            }
        }

        return $handler->handle($request);
    }

    private function requiredStepResponse(
        ServerRequestInterface $request,
        string $nextStepURL,
        bool $isPrimaryAuthenticationComplete
    ): ResponseInterface
    {
        if ($this->isBrowserRequest($request)) {
            return (new Response())->withStatus(302)->withHeader('Location', $nextStepURL);
        }

        $status = $isPrimaryAuthenticationComplete ? 403 : 401;
        $message = $isPrimaryAuthenticationComplete
            ? gettext('Complete the required account security step before continuing')
            : gettext('Additional authentication is required');
        $response = new Response();
        $response->getBody()->write(json_encode(['error' => $message, 'code' => $status]));

        return $response->withStatus($status)->withHeader('Content-Type', 'application/json');
    }

    /**
     * Allow only the exact HTTP actions needed to complete the active step.
     * Recovery-code rotation and 2FA removal are intentionally absent.
     */
    private function isRequiredStepRequestAllowed(ServerRequestInterface $request, string $nextStepURL): bool
    {
        $rootPath = rtrim(SystemURLs::getRootPath(), '/');
        $requiredStepPath = parse_url($nextStepURL, PHP_URL_PATH);
        $requestSignature = strtoupper($request->getMethod()) . ' ' . $request->getUri()->getPath();

        $allowedRequests = match ($requiredStepPath) {
            $rootPath . '/session/two-factor' => [
                'GET ' . $rootPath . '/session/two-factor',
                'POST ' . $rootPath . '/session/two-factor',
            ],
            $rootPath . '/v2/user/current/changepassword' => [
                'GET ' . $rootPath . '/v2/user/current/changepassword',
                'POST ' . $rootPath . '/v2/user/current/changepassword',
            ],
            $rootPath . '/v2/user/current/manage2fa' => [
                'GET ' . $rootPath . '/v2/user/current/manage2fa',
                'GET ' . $rootPath . '/v2/user/current/enroll2fa',
                'GET ' . $rootPath . '/api/user/current/2fa-status',
                'POST ' . $rootPath . '/api/user/current/reauthenticate',
                'POST ' . $rootPath . '/api/user/current/refresh2fasecret',
                'POST ' . $rootPath . '/api/user/current/cancel2faenrollment',
                'POST ' . $rootPath . '/api/user/current/test2FAEnrollmentCode',
            ],
            default => [],
        };

        return in_array($requestSignature, $allowedRequests, true);
    }

    /**
     * Check whether the current request targets a page that must remain
     * accessible even when the user has no admin permissions. Without these
     * exemptions, limited-permission users get stuck in a redirect loop
     * because AuthMiddleware blocks the page the auth system is sending
     * them to. See #8680.
     *
     * Exempt paths:
     *  - /user/current/changepassword  — forced password change on first login
     *  - /user/current/manage2fa       — forced 2FA enrollment when bRequire2FA is on
     *  - /user/current/enroll2fa       — backward-compat alias for manage2fa
     */
    private function isAuthFlowExemptPath(ServerRequestInterface $request): bool
    {
        $rootPath = rtrim(SystemURLs::getRootPath(), '/');
        $path = $request->getUri()->getPath();
        $requestSignature = strtoupper($request->getMethod()) . ' ' . $path;

        return in_array($requestSignature, [
            'GET ' . $rootPath . '/v2/user/current/changepassword',
            'POST ' . $rootPath . '/v2/user/current/changepassword',
            'GET ' . $rootPath . '/v2/user/current/manage2fa',
            'GET ' . $rootPath . '/v2/user/current/enroll2fa',
        ], true);
    }

    private function isPath(ServerRequestInterface $request, string $pathPart): bool
    {
        // explode produces an empty string at index 0 for paths starting with '/',
        // so use in_array to check if the segment exists anywhere in the path
        $pathAry = explode('/', $request->getUri()->getPath());
        return in_array($pathPart, $pathAry, true);
    }

    /**
     * Redirect to the login page, storing the originally requested path in the session
     * so the user can be returned there after successful login.
     * The return path is stored server-side (session) to prevent open-redirect attacks
     * via a crafted query parameter.
     */
    private function redirectToLogin(ServerRequestInterface $request): ResponseInterface
    {
        // Capture the originally requested path (with query string) for post-login redirect.
        $path = $request->getUri()->getPath();
        $query = $request->getUri()->getQuery();
        $fullPath = $query !== '' ? $path . '?' . $query : $path;

        // Validate the path (empty string fallback means "don't store" on failure).
        // RedirectUtils::stripAndValidatePath() strips the root path and validates for safety.
        $safePath = RedirectUtils::stripAndValidatePath($fullPath);
        if ($safePath !== '') {
            $_SESSION['location'] = $safePath;
        }

        $response = new Response();
        $redirectUrl = SystemURLs::getRootPath() . '/session/begin';

        return $response->withStatus(302)->withHeader('Location', $redirectUrl);
    }

}
