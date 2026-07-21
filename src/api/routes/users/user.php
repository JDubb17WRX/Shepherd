<?php

use ChurchCRM\Authentication\AuthenticationManager;
use ChurchCRM\model\ChurchCRM\User;
use ChurchCRM\Slim\Middleware\Api\UserMiddleware;
use ChurchCRM\Slim\Middleware\CSRFMiddleware;
use ChurchCRM\Slim\SlimUtils;
use ChurchCRM\Utils\LoggerUtils;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Slim\Exception\HttpConflictException;
use Slim\Exception\HttpForbiddenException;
use Slim\Routing\RouteCollectorProxy;

$app->group('/user/{userId:[0-9]+}', function (RouteCollectorProxy $group): void {
    $group->post('/apikey/reveal', 'revealAPIKey')
        ->add(new CSRFMiddleware('api_key_management'));
    $group->post('/apikey/regen', 'genAPIKey')
        ->add(new CSRFMiddleware('api_key_management'));
    $group->post('/config/{key}', 'updateUserConfig');
})->add(UserMiddleware::class);

function requireRecentAPIKeyManagementAuthentication(Request $request, Response $response): ?Response
{
    if (!AuthenticationManager::isCompletedLocalAuthentication()) {
        throw new HttpForbiddenException(
            $request,
            gettext('This action requires a signed-in browser session.')
        );
    }
    if (!AuthenticationManager::hasRecentSecurityActionAuthentication()) {
        return noStoreAPIKeyResponse(SlimUtils::renderJSON(
            $response->withStatus(428),
            [
                'error' => gettext('Please confirm your current password before managing API credentials.'),
                'code' => 'reauthentication_required',
            ]
        ));
    }

    return null;
}

function noStoreAPIKeyResponse(Response $response): Response
{
    return $response
        ->withHeader('Cache-Control', 'no-store, private')
        ->withHeader('Pragma', 'no-cache');
}

/**
 * @OA\Post(
 *     path="/user/{userId}/apikey/reveal",
 *     summary="Reveal the current API key after recent browser reauthentication",
 *     tags={"Users"},
 *     security={{"BrowserSessionAuth":{}}},
 *     @OA\Parameter(name="userId", in="path", required=true, @OA\Schema(type="integer")),
 *     @OA\Response(response=200, description="Current API key",
 *         @OA\JsonContent(@OA\Property(property="apiKey", type="string", nullable=true))
 *     ),
 *     @OA\Response(response=401, description="Browser session is no longer valid"),
 *     @OA\Response(response=428, description="Recent password confirmation required"),
 *     @OA\Response(response=403, description="Browser session or CSRF validation failed")
 * )
 */
function revealAPIKey(Request $request, Response $response, array $args): Response
{
    $challenge = requireRecentAPIKeyManagementAuthentication($request, $response);
    if ($challenge !== null) {
        return $challenge;
    }
    /** @var User $user */
    $user = $request->getAttribute('user');

    return noStoreAPIKeyResponse(SlimUtils::renderJSON(
        $response,
        ['apiKey' => $user->getApiKey()]
    ));
}

/**
 * @OA\Post(
 *     path="/user/{userId}/apikey/regen",
 *     summary="Regenerate the API key for a user",
 *     tags={"Users"},
 *     security={{"BrowserSessionAuth":{}}},
 *     @OA\Parameter(name="userId", in="path", required=true, @OA\Schema(type="integer")),
 *     @OA\Response(response=200, description="New API key",
 *         @OA\JsonContent(@OA\Property(property="apiKey", type="string"))
 *     )
 * )
 */
function genAPIKey(Request $request, Response $response, array $args): Response
{
    $challenge = requireRecentAPIKeyManagementAuthentication($request, $response);
    if ($challenge !== null) {
        return $challenge;
    }
    /** @var User $user */
    $user = $request->getAttribute('user');
    $apiKey = $user->regenerateApiKeyIfCurrent($user->getApiKey());
    if ($apiKey === null) {
        throw new HttpConflictException($request, gettext('The API key changed. Reload the page and try again.'));
    }
    AuthenticationManager::rotateAuthenticatedSessionAfterSecurityMutation();
    try {
        $user->createTimeLineNote('api-key-regen');
    } catch (\Throwable $exception) {
        // The credential is already rotated. Audit-note availability must not
        // suppress delivery of the new key or undo session invalidation.
        try {
            LoggerUtils::getAppLogger()->warning('Unable to record API key regeneration timeline note', [
                'userId' => $user->getId(),
                'exception' => $exception,
            ]);
        } catch (\Throwable $loggingError) {
            // The security mutation and response remain authoritative.
        }
    }

    return noStoreAPIKeyResponse(SlimUtils::renderJSON($response, ['apiKey' => $apiKey]));
}

/**
 * @OA\Post(
 *     path="/user/{userId}/config/{key}",
 *     summary="Update a named config string for a user",
 *     tags={"Users"},
 *     security={{"ApiKeyAuth":{}}},
 *     @OA\Parameter(name="userId", in="path", required=true, @OA\Schema(type="integer")),
 *     @OA\Parameter(name="key", in="path", required=true, @OA\Schema(type="string")),
 *     @OA\RequestBody(required=true,
 *         @OA\JsonContent(@OA\Property(property="value", type="string"))
 *     ),
 *     @OA\Response(response=200, description="Updated config key/value pair")
 * )
 */
function updateUserConfig(Request $request, Response $response, array $args): Response
{
    $user = $request->getAttribute('user');
    $userConfigName = $args['key'];
    $parsedBody = $request->getParsedBody();
    $newValue = $parsedBody['value'];
    $user->setUserConfigString($userConfigName, $newValue);
    $user->save();

    if ($user->getUserConfigString($userConfigName) !== $newValue) {
        throw new \Exception('user config string does not match provided value');
    }

    return SlimUtils::renderJSON($response, [$userConfigName => $newValue]);
}
