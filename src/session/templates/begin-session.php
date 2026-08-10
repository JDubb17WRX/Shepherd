<?php

use ChurchCRM\dto\ChurchMetaData;
use ChurchCRM\dto\SystemConfig;
use ChurchCRM\dto\SystemURLs;

$sPageTitle = gettext('Sign In');
$sBodyClass = 'page-auth page-login shepherd-auth';
require SystemURLs::getDocumentRoot() . '/Include/HeaderNotLoggedIn.php';

if (isset($_GET['Timeout'])) {
    $loginPageMsg = gettext('Your previous session timed out. Please login again.');
}

$contactPhone = ChurchMetaData::getChurchPhone();
$contactEmail = ChurchMetaData::getChurchEmail();
$contactWebsite = ChurchMetaData::getChurchWebSite();
?>
<div class="login-container">
  <div class="login-card">
    <div class="login-card-header">
      <div class="login-header-logo"><img src="/images/logo.png" alt="Shepherd"></div>
      <h1 class="login-header-church-name">Shepherd</h1>
      <p class="login-header-tagline">Elkins Park Reformed Presbyterian Church</p>
    </div>
    <div class="login-card-body">
      <div class="login-tab-control" role="tablist" aria-label="<?= gettext('Account options') ?>">
        <span class="login-tab-btn active" role="tab" aria-selected="true"><i class="fa-solid fa-right-to-bracket" aria-hidden="true"></i> <?= gettext('Sign In') ?></span>
        <a href="<?= SystemURLs::getRootPath() ?>/session/signup" class="login-tab-btn" role="tab" aria-selected="false"><i class="fa-solid fa-user-plus" aria-hidden="true"></i> <?= gettext('Sign Up') ?></a>
      </div>

      <?php if (isset($sErrorText)): ?><div class="alert alert-danger" role="alert"><?= htmlspecialchars($sErrorText) ?></div><?php endif; ?>
      <?php if (isset($loginPageMsg)): ?><div class="alert alert-warning" role="status"><?= htmlspecialchars($loginPageMsg) ?></div><?php endif; ?>

      <form method="post" name="LoginForm" action="<?= $localAuthNextStepURL ?>">
        <div class="mb-3"><label for="UserBox" class="form-label"><?= gettext('Username') ?></label><input type="text" id="UserBox" name="User" class="form-control" value="<?= htmlspecialchars($prefilledUserName) ?>" autocomplete="username" required autofocus></div>
        <div class="mb-3"><label for="PasswordBox" class="form-label"><?= gettext('Password') ?></label><input type="password" id="PasswordBox" name="Password" class="form-control" autocomplete="current-password" required></div>
        <div class="form-footer"><span></span><?php if (SystemConfig::getBooleanValue('bEnableLostPassword') && SystemConfig::isEmailEnabled()): ?><a href="<?= htmlspecialchars($forgotPasswordURL) ?>"><?= gettext('Forgot password?') ?></a><?php endif; ?></div>
        <button type="submit" class="btn-sign-in"><?= gettext('Sign in') ?></button>
      </form>

      <?php if ($contactPhone || $contactEmail || $contactWebsite): ?>
        <div class="login-contact-footer">
          <?php if ($contactPhone): ?><a href="tel:<?= htmlspecialchars($contactPhone) ?>"><i class="fa-solid fa-phone" aria-hidden="true"></i> <?= htmlspecialchars($contactPhone) ?></a><?php endif; ?>
          <?php if ($contactEmail): ?><a href="mailto:<?= htmlspecialchars($contactEmail) ?>"><i class="fa-solid fa-envelope" aria-hidden="true"></i> <?= htmlspecialchars($contactEmail) ?></a><?php endif; ?>
          <?php if ($contactWebsite): ?><a href="<?= htmlspecialchars($contactWebsite) ?>" target="_blank" rel="noopener noreferrer"><i class="fa-solid fa-globe" aria-hidden="true"></i> Church website</a><?php endif; ?>
        </div>
      <?php endif; ?>
    </div>
  </div>
</div>
<?php require SystemURLs::getDocumentRoot() . '/Include/FooterNotLoggedIn.php'; ?>
