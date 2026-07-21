<?php

namespace ChurchCRM\model\ChurchCRM;

use ChurchCRM\model\ChurchCRM\Base\Token as BaseToken;
use ChurchCRM\Utils\DateTimeUtils;
use Propel\Runtime\ActiveQuery\Criteria;

/**
 * Skeleton subclass for representing a row from the 'tokens' table.
 *
 *
 *
 * You should add additional methods to this class to meet the
 * application requirements.  This class will only be generated as
 * long as it does not already exist in the output directory.
 */
class Token extends BaseToken
{
    public const TYPE_FAMILY_VERIFY = 'verifyFamily';
    private const MAX_CONSUME_ATTEMPTS = 10;
    private const TYPE_PASSWORD = 'password';

    public function build($type, $referenceId): void
    {
        $this->setReferenceId($referenceId);
        $this->setToken(bin2hex(random_bytes(32)));
        switch ($type) {
            case 'verifyFamily':
                $this->setValidUntilDate(DateTimeUtils::getToday()->modify('+1 week'));
                $this->setRemainingUses(5);
                break;
            case 'password':
                $this->setValidUntilDate(DateTimeUtils::getToday()->modify('+1 day'));
                $this->setRemainingUses(1);
                break;
        }
        $this->setType($type);
    }

    public function isVerifyFamilyToken(): bool
    {
        return self::TYPE_FAMILY_VERIFY === $this->getType();
    }

    public function isPasswordResetToken(): bool
    {
        return self::TYPE_PASSWORD === $this->getType();
    }

    public function isValid(): bool
    {
        $hasUses = true;
        if ($this->getRemainingUses() !== null) {
            $hasUses = $this->getRemainingUses() > 0;
        }

        $stillValidDate = true;
        if ($this->getValidUntilDate() !== null) {
            $today = DateTimeUtils::getToday();
            $stillValidDate = $this->getValidUntilDate() > $today;
        }

        return $stillValidDate && $hasUses;
    }

    /**
     * Atomically consumes one use of a non-expired token.
     *
     * The remaining-use and expiry predicates are part of the UPDATE so two
     * requests cannot both consume the same final use after validating stale
     * in-memory state. A short retry loop lets genuinely concurrent users of a
     * multi-use token each consume a distinct use.
     */
    public function consume(): bool
    {
        $tokenValue = (string) $this->getToken();
        if ($tokenValue === '') {
            return false;
        }

        for ($attempt = 0; $attempt < self::MAX_CONSUME_ATTEMPTS; ++$attempt) {
            // A scalar projection bypasses Propel's instance pool, so a retry
            // observes the value committed by the competing request.
            $remainingUses = TokenQuery::create()
                ->filterByToken($tokenValue)
                ->filterByValidUntilDate(DateTimeUtils::getToday(), Criteria::GREATER_THAN)
                ->select('RemainingUses')
                ->findOne();
            if ($remainingUses === null || (int) $remainingUses <= 0) {
                return false;
            }
            $remainingUses = (int) $remainingUses;

            $updatedRows = TokenQuery::create()
                ->filterByToken($tokenValue)
                ->filterByRemainingUses($remainingUses)
                ->filterByValidUntilDate(DateTimeUtils::getToday(), Criteria::GREATER_THAN)
                ->update(['RemainingUses' => $remainingUses - 1]);
            if ($updatedRows === 1) {
                $this->setRemainingUses($remainingUses - 1);

                return true;
            }
        }

        return false;
    }
}
