<?php

use ChurchCRM\Authentication\AuthenticationManager;
use ChurchCRM\Authentication\Exceptions\PasswordChangeException;
use ChurchCRM\dto\SystemURLs;
use ChurchCRM\Slim\Middleware\CSRFMiddleware;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Slim\Exception\HttpBadRequestException;
use Slim\Routing\RouteCollectorProxy;
use Slim\Views\PhpRenderer;

$app->group('/user/current', function (RouteCollectorProxy $group): void {
    $group->get('/manage2fa', 'manage2fa');
    $group->get('/enroll2fa', 'manage2fa'); // backward compatibility
    $group->get('/changepassword', 'changepassword');
    $group->post('/changepassword', 'changepassword')->add(new CSRFMiddleware('user_change_password'));
});

function manage2fa(Request $request, Response $response, array $args): Response
{
    $renderer = new PhpRenderer('templates/user/');
    $curUser = AuthenticationManager::getCurrentUser();
    $pageArgs = [
        'sRootPath' => SystemURLs::getRootPath(),
        'user'      => $curUser,
    ];

    return $renderer->render($response, 'manage-2fa.php', $pageArgs);
}

function changepassword(Request $request, Response $response, array $args): Response
{
    $renderer = new PhpRenderer('templates/');
    $curUser = AuthenticationManager::getCurrentUser();
    $pageArgs = [
        'sRootPath' => SystemURLs::getRootPath(),
        'user'      => $curUser,
        'isForced'  => $curUser->getNeedPasswordChange(),
    ];

    if ($request->getMethod() === 'POST') {
        $loginRequestBody = $request->getParsedBody();
        $wasForced = $curUser->getNeedPasswordChange();
        if (!is_array($loginRequestBody)
            || !isset($loginRequestBody['OldPassword'], $loginRequestBody['NewPassword1'], $loginRequestBody['NewPassword2'])
            || !is_string($loginRequestBody['OldPassword'])
            || !is_string($loginRequestBody['NewPassword1'])
            || !is_string($loginRequestBody['NewPassword2'])) {
            throw new HttpBadRequestException($request, gettext('Complete all password fields.'));
        }

        if (!hash_equals($loginRequestBody['NewPassword1'], $loginRequestBody['NewPassword2'])) {
            $pageArgs['sNewPasswordError'] = gettext('The new passwords do not match.');

            return $renderer->render($response, 'user/changepassword.php', $pageArgs);
        }

        try {
            if (!AuthenticationManager::reauthenticateForSecurityAction($loginRequestBody['OldPassword'])) {
                throw new PasswordChangeException('Old', gettext('Incorrect password supplied for current user'));
            }
            $securityMarkers = AuthenticationManager::getAuthenticatedSecurityMarkers();
            $newPasswordHash = $curUser->userChangePassword(
                $loginRequestBody['OldPassword'],
                $loginRequestBody['NewPassword1'],
                $securityMarkers['passwordHash'],
                $securityMarkers['twoFactorSecret'],
                $securityMarkers['recoveryCodes']
            );
            AuthenticationManager::synchronizeAuthenticatedPasswordHash($newPasswordHash);

            if ($wasForced) {
                // Forced password change complete — redirect so that ChurchInfoRequiredMiddleware
                // can route the admin to the church-info setup page (or the dashboard if already set).
                return $response->withStatus(302)->withHeader('Location', SystemURLs::getRootPath() . '/v2/dashboard');
            }

            return $renderer->render($response, 'common/success-changepassword.php', $pageArgs);
        } catch (PasswordChangeException $pwChangeExc) {
            $pageArgs['s' . $pwChangeExc->AffectedPassword . 'PasswordError'] = $pwChangeExc->getMessage();
        }
    }

    return $renderer->render($response, 'user/changepassword.php', $pageArgs);
}
