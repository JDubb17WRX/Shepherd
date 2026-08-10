<?php

use ChurchCRM\Bootstrapper;
use ChurchCRM\dto\SystemURLs;
use ChurchCRM\Plugin\PluginManager;
use ChurchCRM\Service\SystemService;

?>

<div class="auth-footer">
  <div>
    <strong>Shepherd</strong> for Elkins Park Reformed Presbyterian Church.
    Based on <a href="https://github.com/ChurchCRM/CRM/tree/7.5.0" target="_blank" rel="noopener noreferrer">ChurchCRM 7.5.0</a> under the MIT License.
  </div>
  <div class="auth-footer-social">
    <a href="https://www.facebook.com/getChurchCRM" target="_blank" rel="noopener noreferrer" title="Facebook">
      <i class="fa-brands fa-facebook"></i>
    </a>
    <a href="https://www.instagram.com/getchurchcrm/" target="_blank" rel="noopener noreferrer" title="Instagram">
      <i class="fa-brands fa-instagram"></i>
    </a>
    <a href="https://x.com/getChurchCRM" target="_blank" rel="noopener noreferrer" title="X">
      <i class="fa-brands fa-x-twitter"></i>
    </a>
    <a href="https://www.linkedin.com/company/getchurchcrm/" target="_blank" rel="noopener noreferrer" title="LinkedIn">
      <i class="fa-brands fa-linkedin"></i>
    </a>
    <a href="https://www.youtube.com/@getChurchCRM" target="_blank" rel="noopener noreferrer" title="YouTube">
      <i class="fa-brands fa-youtube"></i>
    </a>
  </div>
</div>

  <!-- InputMask -->
  <script src="<?= SystemURLs::assetVersioned('/skin/external/inputmask/jquery.inputmask.min.js') ?>"></script>
  <script src="<?= SystemURLs::assetVersioned('/skin/external/inputmask/inputmask.binding.js') ?>"></script>

  <script src="<?= SystemURLs::assetVersioned('/skin/external/bootstrap-datepicker/bootstrap-datepicker.min.js') ?>"></script>
  <script src="<?= SystemURLs::assetVersioned('/skin/external/bootbox/bootbox.min.js') ?>"></script>

  <script src="<?= SystemURLs::assetVersioned('/skin/external/i18next/i18next.min.js') ?>"></script>
  <script src="<?= SystemURLs::assetVersioned('/skin/external/just-validate/just-validate.production.min.js') ?>"></script>

  <script src="<?= SystemURLs::assetVersioned('/skin/v2/locale-loader.min.js') ?>"></script>
  <script src="<?= SystemURLs::assetVersioned('/skin/js/shepherd-embed.js') ?>"></script>
  <script nonce="<?= SystemURLs::getCSPNonce() ?>">
    // Load locale files dynamically
    (function() {
        const localeConfig = <?= json_encode(Bootstrapper::getCurrentLocale()->getLocaleConfigArray()) ?>;
        if (window.CRM && window.CRM.loadLocaleFiles) {
            window.CRM.loadLocaleFiles(localeConfig);
        }
    })();
  </script>
  <?= PluginManager::getPluginFooterContent() ?>
</body>
</html>
