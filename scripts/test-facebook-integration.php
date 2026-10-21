<?php

require __DIR__ . '/../src/vendor/autoload.php';
require __DIR__ . '/../src/plugins/core/facebook-integration/src/FacebookIntegrationPlugin.php';

use ChurchCRM\Plugins\FacebookIntegration\FacebookIntegrationPlugin;

class FacebookIntegrationTestPlugin extends FacebookIntegrationPlugin
{
    public array $values = [];

    protected function getConfigValue(string $key): string
    {
        return $this->values[$key] ?? '';
    }
}

$plugin = new FacebookIntegrationTestPlugin(__DIR__ . '/../src/plugins/core/facebook-integration');
$checks = 0;
$check = static function (bool $value, string $label) use (&$checks): void {
    if (!$value) {
        throw new RuntimeException($label);
    }
    $checks++;
};
$check(!$plugin->isConfigured(), 'Empty setup remains unconfigured');
foreach (['https://www.facebook.com/examplechurch', 'https://facebook.com/profile.php?id=123456789'] as $url) {
    $check(FacebookIntegrationPlugin::isPublicPageUrl($url), 'Public HTTPS Page URL accepted');
}
foreach (['javascript:alert(1)', 'http://facebook.com/church', 'https://facebook.com.evil.test/church',
    'https://user:password@facebook.com/church', 'https://facebook.com:8443/church', 'https://facebook.com/'] as $url) {
    $check(!FacebookIntegrationPlugin::isPublicPageUrl($url), 'Unsafe or incomplete Page URL rejected');
}
$plugin->values = ['pageUrl' => 'https://www.facebook.com/examplechurch', 'pageId' => '12345', 'pixelId' => '123456789012345'];
$plugin->boot();
$check($plugin->isConfigured(), 'Valid optional identifiers can be prepared');
$check($plugin->getHeadContent() === '' && $plugin->getFooterContent() === '', 'Configured plugin emits no tracking or embeds');
$plugin->values['pixelId'] = "123');alert(1)//";
$check(!$plugin->isConfigured(), 'Invalid identifier is not ready for future use');
$check($plugin->getHeadContent() === '' && $plugin->getFooterContent() === '', 'Invalid input cannot emit executable content');
$manifest = json_decode(file_get_contents($plugin->getBasePath() . '/plugin.json'), true, 512, JSON_THROW_ON_ERROR);
$check(array_column($manifest['settings'], 'key') === array_column($plugin->getSettingsSchema(), 'key'), 'Manifest and settings form stay aligned');
echo "$checks Facebook integration checks passed.\n";
