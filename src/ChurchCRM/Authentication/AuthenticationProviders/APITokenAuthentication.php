<?php

namespace ChurchCRM\Authentication\AuthenticationProviders;

use ChurchCRM\Authentication\AuthenticationResult;
use ChurchCRM\Authentication\Requests\APITokenAuthenticationRequest;
use ChurchCRM\Authentication\Requests\AuthenticationRequest;
use ChurchCRM\Exceptions\NotImplementedException;
use ChurchCRM\model\ChurchCRM\User;
use ChurchCRM\model\ChurchCRM\UserQuery;
use ChurchCRM\Utils\LoggerUtils;

class APITokenAuthentication implements IAuthenticationProvider
{
    private ?User $currentUser = null;

    public function __serialize(): array
    {
        // API-token identity is valid only for the request carrying the token.
        // Keep the live object usable by the current handler, but never persist
        // its User into the PHP session for a later token-less request.
        return [];
    }

    public function __unserialize(array $data): void
    {
        $this->currentUser = null;
    }

    public function getCurrentUser(): ?User
    {
        return $this->currentUser;
    }

    public function authenticate(AuthenticationRequest $AuthenticationRequest): AuthenticationResult
    {
        if (!$AuthenticationRequest instanceof APITokenAuthenticationRequest) {
            throw new \Exception('Unable to process request as APITokenAuthenticationRequest');
        }
        $authenticationResult = new AuthenticationResult();
        $authenticationResult->isAuthenticated = false;
        $authenticationResult->preventRedirect = true;
        $candidateUser = UserQuery::create()->findOneByApiKey($AuthenticationRequest->APIToken);

        if ($candidateUser instanceof User && $candidateUser->isApiAuthenticationEligible()) {
            $this->currentUser = $candidateUser;
            LoggerUtils::getAuthLogger()->debug(gettext('User authenticated via API Key: ') . $this->currentUser->getName());
            $authenticationResult->isAuthenticated = true;
        } else {
            $this->currentUser = null;
            LoggerUtils::getAuthLogger()->warning(gettext('Unsuccessful API Key authentication attempt'));
        }

        return $authenticationResult;
    }

    public function validateUserSessionIsActive(bool $updateLastOperationTimestamp): AuthenticationResult
    {
        // APITokens are session-less, so just always say false.
        $authenticationResult = new AuthenticationResult();
        $authenticationResult->isAuthenticated = false;

        return $authenticationResult;
    }

    public function endSession(): void
    {
        $this->currentUser = null;
    }

    public function getPasswordChangeURL(): string
    {
        throw new NotImplementedException();
    }
}
