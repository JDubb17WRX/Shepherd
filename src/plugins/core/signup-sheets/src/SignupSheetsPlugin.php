<?php

namespace ChurchCRM\Plugins\SignupSheets;

use ChurchCRM\Plugin\AbstractPlugin;
use RuntimeException;

/**
 * Signup Sheets Plugin.
 *
 * Volunteer and potluck signup sheets, in the spirit of SignUpGenius:
 * - A sheet describes an occasion, optionally attached to a ChurchCRM event
 * - Slots describe what is needed — dishes to bring, roles to serve, shifts to cover
 * - Members claim slots inside the CRM, or anyone can claim them via a share link
 */
class SignupSheetsPlugin extends AbstractPlugin
{
    private static ?SignupSheetsPlugin $instance = null;

    private ?SignupSheetService $service = null;

    /**
     * Memoised per request: the plugin list page asks whether the plugin is
     * configured, and that answer is a database round trip.
     *
     * @var string[]|null
     */
    private ?array $missingTables = null;

    public function __construct(string $basePath = '')
    {
        parent::__construct($basePath);
        self::$instance = $this;
    }

    public static function getInstance(): ?SignupSheetsPlugin
    {
        return self::$instance;
    }

    public function getId(): string
    {
        return 'signup-sheets';
    }

    public function getName(): string
    {
        return gettext('Signup Sheets');
    }

    public function getDescription(): string
    {
        return gettext('Volunteer and potluck signup sheets people can fill from inside the CRM or a public share link.');
    }

    public function getType(): string
    {
        return 'core';
    }

    public function getMinimumCRMVersion(): string
    {
        return '7.6.2';
    }

    public function boot(): void
    {
        // No hooks: the plugin owns its own tables and routes and does not
        // observe core lifecycle events. The service is created lazily.
    }

    /**
     * Lazily-created service, shared by the authenticated and public routes.
     */
    public function getService(): SignupSheetService
    {
        return $this->service ??= new SignupSheetService();
    }

    /**
     * Nothing must be configured before the plugin is useful, but it cannot
     * run without the four tables its schema file creates on enable.
     */
    public function isConfigured(): bool
    {
        return $this->getConfigurationError() === null;
    }

    /**
     * Explains a half-provisioned install — tables dropped by hand, or a
     * restore from a dump taken before the plugin was enabled.
     *
     * Unlike the enable gate, this runs on a page render, so a database that
     * cannot answer becomes a message rather than an exception. It still
     * reports the plugin as unconfigured: unverified is not the same as fine.
     */
    public function getConfigurationError(): ?string
    {
        try {
            $this->missingTables ??= $this->getMissingTables();
        } catch (RuntimeException) {
            return gettext('Signup Sheets could not verify its database tables. Check the database connection, then see the application log.');
        }

        if ($this->missingTables === []) {
            return null;
        }

        return sprintf(
            gettext('Signup Sheets is missing its database tables (%s). Disable and re-enable the plugin to create them.'),
            implode(', ', $this->missingTables)
        );
    }

    /**
     * May sheets be published at a public share link?
     */
    public function isPublicSharingAllowed(): bool
    {
        $value = $this->getConfigValue('allowPublicSheets');

        // Default to enabled when the admin has never touched the setting.
        return $value === '' ? true : $this->getBooleanConfigValue('allowPublicSheets');
    }

    /**
     * Maximum public signups accepted from one IP address per hour.
     */
    public function getPublicRateLimit(): int
    {
        $configured = (int) $this->getConfigValue('publicRateLimit');

        return $configured > 0 ? $configured : 20;
    }

    public function getContactEmail(): string
    {
        return $this->getConfigValue('contactEmail');
    }

    public function getMenuItems(): array
    {
        return [
            [
                'parent' => 'events',
                'label' => gettext('Signup Sheets'),
                'url' => 'plugins/signup-sheets',
                'icon' => 'fa-clipboard-list',
            ],
        ];
    }

    public function getSettingsSchema(): array
    {
        return [
            [
                'key' => 'allowPublicSheets',
                'label' => gettext('Allow public share links'),
                'type' => 'checkbox',
                'required' => false,
                'help' => gettext('When enabled, a sheet can be published at a secret link that anyone can use without a CRM login.'),
            ],
            [
                'key' => 'publicRateLimit',
                'label' => gettext('Public signups per hour per visitor'),
                'type' => 'number',
                'required' => false,
                'help' => gettext('Maximum signups accepted from one IP address per hour on public sheets.'),
            ],
            [
                'key' => 'contactEmail',
                'label' => gettext('Sheet contact email'),
                'type' => 'text',
                'required' => false,
                'help' => gettext('Shown on public sheets so volunteers know who to ask about the event.'),
            ],
        ];
    }

    public function getClientConfig(): array
    {
        return [
            'allowPublicSheets' => $this->isPublicSharingAllowed(),
        ];
    }
}
