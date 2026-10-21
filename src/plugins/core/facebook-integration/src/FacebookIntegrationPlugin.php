<?php

namespace ChurchCRM\Plugins\FacebookIntegration;

use ChurchCRM\Plugin\AbstractPlugin;

class FacebookIntegrationPlugin extends AbstractPlugin
{
    public function getId(): string
    {
        return 'facebook-integration';
    }

    public function getName(): string
    {
        return gettext('Facebook Integration');
    }

    public function getDescription(): string
    {
        return gettext('Facebook Page and optional Meta Pixel setup. Tracking and embedded content remain inactive.');
    }

    public function boot(): void
    {
    }

    public function getSettingsUrl(): ?string
    {
        return '/plugins/facebook-integration/settings';
    }

    public function getSettingsSchema(): array
    {
        return [
            ['key' => 'pageUrl', 'label' => gettext('Public Facebook Page URL'), 'type' => 'text',
                'help' => gettext('The church\'s public https://www.facebook.com/... address. Leave blank until available.')],
            ['key' => 'pageId', 'label' => gettext('Facebook Page ID (optional)'), 'type' => 'text',
                'help' => gettext('The numeric Page ID, if supplied by Meta. This is not an access token.')],
            ['key' => 'pixelId', 'label' => gettext('Meta Pixel ID (optional)'), 'type' => 'text',
                'help' => gettext('Store the numeric Pixel ID for future public-website integration. Saving or enabling this plugin does not activate tracking.')],
        ];
    }

    public function getConfigurationError(): ?string
    {
        $url = trim($this->getConfigValue('pageUrl'));
        if ($url !== '' && !self::isPublicPageUrl($url)) {
            return gettext('Enter an HTTPS Facebook Page URL without a username, password, or custom port.');
        }
        foreach (['pageId', 'pixelId'] as $key) {
            $value = trim($this->getConfigValue($key));
            if ($value !== '' && !preg_match('/^[0-9]{1,32}$/D', $value)) {
                return gettext('Facebook Page and Meta Pixel IDs must contain digits only.');
            }
        }

        return null;
    }

    public function isConfigured(): bool
    {
        return $this->getConfigurationError() === null
            && (trim($this->getConfigValue('pageUrl')) !== '' || trim($this->getConfigValue('pixelId')) !== '');
    }

    public static function isPublicPageUrl(string $url): bool
    {
        $parts = parse_url($url);

        return is_array($parts)
            && filter_var($url, FILTER_VALIDATE_URL) !== false
            && ($parts['scheme'] ?? '') === 'https'
            && in_array(strtolower($parts['host'] ?? ''), ['facebook.com', 'www.facebook.com', 'm.facebook.com'], true)
            && !isset($parts['user']) && !isset($parts['pass']) && !isset($parts['port'])
            && trim($parts['path'] ?? '', '/') !== '';
    }

    public function getHeadContent(): string
    {
        return '';
    }

    public function getFooterContent(): string
    {
        return '';
    }
}
