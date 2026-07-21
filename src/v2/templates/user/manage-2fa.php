<?php

use ChurchCRM\dto\SystemURLs;
use ChurchCRM\Utils\CSRFUtils;
use ChurchCRM\Utils\InputUtils;

$sPageTitle = $user->getFullName() . ' - ' . gettext("Two-Factor Authentication");
require SystemURLs::getDocumentRoot() . '/Include/Header.php';
?>
<div
  id="two-factor-enrollment-app"
  data-csrf-token="<?= InputUtils::escapeAttribute(CSRFUtils::generateToken('account_security_action')) ?>"
></div>
<script src="<?= SystemURLs::assetVersioned('/skin/v2/two-factor-enrollment.min.js') ?>"></script>
<?php
require SystemURLs::getDocumentRoot() . '/Include/Footer.php';
