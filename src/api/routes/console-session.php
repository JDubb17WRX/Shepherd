<?php

use ChurchCRM\Authentication\AuthenticationManager;
use ChurchCRM\Shepherd\Username;
use ChurchCRM\Slim\SlimUtils;
use ChurchCRM\Utils\LoggerUtils;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Slim\Exception\HttpForbiddenException;

/**
 * Identity endpoint for the bulletin console.
 *
 * nginx calls this as an `auth_request` subrequest in front of the proxied
 * console surfaces. A 2xx admits the request; 401/403 refuses it before the
 * upstream is reached at all. On success the caller's canonical Shepherd
 * username is returned in the `X-Shepherd-Username` response header, which
 * nginx lifts with `auth_request_set` and forwards to the upstream.
 *
 * This is deliberately NOT the website-editor session endpoint, which cannot
 * serve the purpose for two independent reasons:
 *
 *   1. It is `AdminRoleAuthMiddleware`-gated. The console also serves Elders
 *      and Deacons, who are not Shepherd Administrators.
 *   2. It answers in a JSON body, and `auth_request_set` can only read a
 *      *response header*. A body is invisible to nginx.
 *
 * It also returns `displayName` — a full name, which is not an authentication
 * subject and must never be used as one.
 *
 * WHAT THIS ENDPOINT DOES NOT DO
 *
 * It does not decide what the caller may do. Roles live in the website repo's
 * version-controlled `src/data/roles.json`, precisely so that adding an Elder
 * shows up in a diff. Shepherd answers exactly one question — "which account is
 * this browser session?" — and the consumer maps that to a role. Splitting the
 * role decision across two systems is the failure this arrangement exists to
 * avoid, so resist the urge to add a permission check here.
 *
 * Consequently every authenticated account gets a username back, including
 * accounts with no console role at all. That is safe: an unrecognised username
 * resolves to no role downstream and is refused. It is also why the username
 * must be canonical — see `ChurchCRM\Shepherd\Username`, which is also what
 * refuses an email address as a login in the first place.
 *
 * MOUNTED UNDER /background ON PURPOSE
 *
 * `AuthMiddleware` skips the `tLastOperation` bump for `/background` paths.
 * nginx probes this endpoint on *every* request to a proxied path, so mounting
 * it anywhere else would refresh the idle timer continuously and no console
 * session would ever expire.
 */
$app->get('/background/console/session', 'getConsoleSession');

/**
 * @OA\Get(
 *     path="/background/console/session",
 *     summary="Resolve the canonical Shepherd username for the current browser session",
 *     tags={"System"},
 *     @OA\Response(
 *         response=200,
 *         description="Session is a completed local browser session; the canonical username is in the X-Shepherd-Username header",
 *         @OA\Header(header="X-Shepherd-Username", description="Canonical lowercase Shepherd username", @OA\Schema(type="string"))
 *     ),
 *     @OA\Response(response=401, description="No authenticated session"),
 *     @OA\Response(response=403, description="Session is not a completed local browser session, or the username is not canonicalisable")
 * )
 */
function getConsoleSession(Request $request, Response $response, array $args): Response
{
    // API-token callers and half-finished sign-ins both reach route handlers in
    // some paths; neither is a browser session and neither may mint an identity.
    // `isCompletedLocalAuthentication()` rejects both — it requires the local
    // provider and `bPendingTwoFactorAuth !== true`.
    if (!AuthenticationManager::isCompletedLocalAuthentication()) {
        throw new HttpForbiddenException(
            $request,
            'The console requires a signed-in Shepherd browser session.'
        );
    }

    $user = AuthenticationManager::getCurrentUser();
    $username = Username::canonical($user->getUserName());

    if ($username === null) {
        // Fail closed. An account whose name will not canonicalise cannot be
        // matched against the roles file anyway, so emitting anything here
        // could only ever produce a confusing partial success downstream.
        try {
            // The user id, not the username. "Some account was refused" is not
            // an actionable log line, but the name is the very value that just
            // failed validation and it does not belong in the log verbatim.
            // The id identifies the account exactly and is an integer.
            LoggerUtils::getAuthLogger()->warning(
                'Console session refused: username has no canonical form.',
                ['userId' => $user->getId()]
            );
        } catch (\Throwable) {
            // Refusing the session is the security-relevant part; it stands
            // whether or not optional logging succeeds.
        }

        throw new HttpForbiddenException(
            $request,
            'This account cannot be used with the console.'
        );
    }

    // The body is for humans holding curl. nginx reads the header and discards
    // the body, so the header is the load-bearing half of this response.
    return SlimUtils::renderJSON($response, ['username' => $username])
        ->withHeader('X-Shepherd-Username', $username)
        ->withHeader('Cache-Control', 'no-store, private')
        ->withHeader('Pragma', 'no-cache')
        ->withHeader('Vary', 'Cookie');
}
