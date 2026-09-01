import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Shepherd exposes independent liveness and dependency-aware readiness routes', async () => {
    const caddyfile = await read('docker/shepherd/Caddyfile');
    const readinessBlock = caddyfile.match(
        /handle \/shepherd\/healthz \{(?<body>[\s\S]*?)\n    \}/,
    );

    assert.match(caddyfile, /handle \/shepherd\/livez \{/);
    assert.match(caddyfile, /respond `\{"status":"alive"\}` 200/);
    assert.ok(readinessBlock, 'readiness handler must exist');
    assert.match(readinessBlock.groups.body, /rewrite \* \/shepherd\/healthz\.php/);
    assert.match(readinessBlock.groups.body, /php_server/);
    assert.doesNotMatch(readinessBlock.groups.body, /respond\s+200/);
    assert.match(caddyfile, /handle \/shepherd\/healthz\.php \{[\s\S]*?respond 404/);
});

test('the container health check uses the protected readiness probe', async () => {
    const dockerfile = await read('docker/shepherd/Dockerfile');

    assert.match(dockerfile, /COPY .*docker\/shepherd\/healthz\.php \.\/healthz\.php/);
    assert.match(dockerfile, /php -l healthz\.php/);
    assert.match(dockerfile, /GET \/shepherd\/healthz HTTP\/1\.0/);
    assert.doesNotMatch(dockerfile, /GET \/shepherd\/livez HTTP\/1\.0/);
});

test('readiness checks schema and persistent paths without probing SMTP', async () => {
    const probe = await read('docker/shepherd/healthz.php');

    assert.match(probe, /MYSQLI_OPT_CONNECT_TIMEOUT, 3/);
    assert.match(probe, /FROM config_cfg/);
    for (const path of [
        'Images',
        'Images/Person',
        'Images/Family',
        'uploads',
        'SQL',
        'logs',
        'tmp_attach',
        'plugins',
    ]) {
        assert.match(probe, new RegExp(`['"]${path}['"]`));
    }
    assert.match(probe, /is_writable/);
    assert.match(probe, /'mail' => 'not_configured'/);
    assert.match(probe, /\$checks\['mail'\] = 'configured'/);
    assert.doesNotMatch(probe, /fsockopen|stream_socket_client|curl_exec|PHPMailer/i);
    assert.doesNotMatch(probe, /getMessage\s*\(/);
});

test('both HTML shells declare an escaped BCP 47 language tag', async () => {
    const [localeInfo, authenticatedHeader, guestHeader] = await Promise.all([
        read('src/ChurchCRM/dto/LocaleInfo.php'),
        read('src/Include/Header.php'),
        read('src/Include/HeaderNotLoggedIn.php'),
    ]);

    assert.match(localeInfo, /function getHtmlLanguageTag\(\): string/);
    assert.match(localeInfo, /str_replace\('_', '-', \$locale\)/);
    for (const header of [authenticatedHeader, guestHeader]) {
        assert.match(
            header,
            /lang="<\?= InputUtils::escapeAttribute\(\$localeInfo->getHtmlLanguageTag\(\)\) \?>"/,
        );
        assert.match(header, /\$localeInfo->isRTL\(\) \? ' dir="rtl"'/);
    }
});

test('website content editing reuses only completed local administrator sessions', async () => {
    const [api, routes, service, repository, bootstrapper, loadConfigs, authMiddleware, caddyfile, upgrades, migration, install] = await Promise.all([
        read('src/api/index.php'),
        read('src/api/routes/website-content.php'),
        read('src/ChurchCRM/Shepherd/WebsiteContentService.php'),
        read('src/ChurchCRM/Shepherd/WebsiteContentRepository.php'),
        read('src/ChurchCRM/Bootstrapper.php'),
        read('src/Include/LoadConfigs.php'),
        read('src/ChurchCRM/Slim/Middleware/AuthMiddleware.php'),
        read('docker/shepherd/Caddyfile'),
        read('src/mysql/upgrade.json'),
        read('src/mysql/upgrade/7.6.1-shepherd-website-content.sql'),
        read('src/mysql/install/Install.sql'),
    ]);

    assert.match(api, /routes\/website-content\.php/);
    assert.match(routes, /\/public\/website-content\/\{pageKey:/);
    assert.match(routes, /\/background\/website-content\/session/);
    assert.match(routes, /->put\('\/\{pageKey:/);
    assert.match(routes, /AdminRoleAuthMiddleware::class/);
    assert.match(routes, /CSRFMiddleware\('website_content_editor'\)/);
    assert.match(routes, /AuthenticationManager::isCompletedLocalAuthentication\(\)/);
    assert.match(routes, /X-CSRF|CSRFToken/);

    assert.match(bootstrapper, /bool \$initializeSession = true/);
    assert.match(bootstrapper, /if \(\$initializeSession\) \{\s+self::initSession\(\);/);
    assert.match(loadConfigs, /isPublicWebsiteContentRead/);
    assert.match(loadConfigs, /isAnonymousEditorProbe/);
    assert.match(loadConfigs, /sessionCookieName/);
    assert.match(authMiddleware, /isPassiveWebsiteEditorProbe/);
    assert.match(authMiddleware, /\? 'debug' : 'warning'/);

    assert.match(service, /MAX_CONTENT_BYTES/);
    assert.match(service, /private const PAGE_KEYS = \[/);
    for (const page of ['home', 'services', 'contact', 'rp-history', 'privacy']) {
        assert.match(service, new RegExp(`'${page}'`));
    }
    assert.match(service, /in_array\(\$pageKey, self::PAGE_KEYS, true\)/);
    assert.match(service, /base' => \$base, 'value' => \$value/);
    assert.match(service, /array_diff\(array_keys\(\$entry\), \['base', 'value'\]\)/);
    assert.match(service, /strlen\(self::encodeContent\(\$normalized\)\)/);
    assert.match(service, /revision_conflict|\['conflict' => true/);
    assert.doesNotMatch(service, /sanitizeHTML|innerHTML/i);

    assert.doesNotMatch(repository, /CREATE TABLE|ensureSchema/);
    assert.match(repository, /SELECT revision[\s\S]*FOR UPDATE/);
    assert.match(repository, /hash_equals\(\$currentRevision, \$expectedRevision\)/);
    assert.match(repository, /\$savedRow = \$snapshot->fetch\(PDO::FETCH_ASSOC\)/);
    assert.match(repository, /commit\(\);\s+return \$savedRow/);

    assert.match(upgrades, /7\.6\.1-shepherd-website-content\.sql/);
    assert.match(migration, /CREATE TABLE IF NOT EXISTS `shepherd_website_content`/);
    assert.match(install, /CREATE TABLE `shepherd_website_content`/);
    assert.match(caddyfile, /request_body @websiteContentUpdate[\s\S]*max_size 2100000/);
});

test('7.6.2 repairs missing fundraiser fields without changing correct schemas', async () => {
    const [upgradeJson, migration, install, ormSchema, composer, packageJson, packageLock, dockerfile, cypressSeed] = await Promise.all([
        read('src/mysql/upgrade.json'),
        read('src/mysql/upgrade/7.6.2-fundraiser-schema-repair.php'),
        read('src/mysql/install/Install.sql'),
        read('orm/schema.xml'),
        read('src/composer.json'),
        read('package.json'),
        read('package-lock.json'),
        read('docker/shepherd/Dockerfile'),
        read('cypress/data/seed.sql'),
    ]);
    const upgrades = JSON.parse(upgradeJson);

    assert.deepEqual(upgrades.current, {
        versions: ['7.6.1'],
        scripts: ['/mysql/upgrade/7.6.2-fundraiser-schema-repair.php'],
        dbVersion: '7.6.2',
    });

    const expectedColumns = ['fr_EndDate', 'fr_Status', 'fr_GoalAmount', 'fr_Type', 'fr_fund_ID'];
    for (const column of expectedColumns) {
        assert.match(migration, new RegExp(`['"]${column}['"]\\s*=>`));
        assert.match(install, new RegExp('`' + column + '`'));
        assert.match(ormSchema, new RegExp(`name="${column}"`));
    }
    assert.match(migration, /information_schema\.COLUMNS/);
    assert.match(migration, /if \(\$fundraiserColumnExists\(\$columnName\)\)/);
    assert.match(migration, /ADD COLUMN `\{\$columnName\}`/);
    assert.match(migration, /\$fundraiserAddedColumns\[\] = \$columnName/);
    assert.match(migration, /in_array\('fr_EndDate', \$fundraiserAddedColumns, true\)/);
    assert.doesNotMatch(migration, /DROP\s+(?:COLUMN|TABLE)/i);

    assert.equal(JSON.parse(composer).version, '7.6.2');
    assert.equal(JSON.parse(packageJson).version, '7.6.2');
    assert.equal(JSON.parse(packageLock).version, '7.6.2');
    assert.equal(JSON.parse(packageLock).packages[''].version, '7.6.2');
    assert.match(dockerfile, /org\.opencontainers\.image\.version="7\.6\.2"/);
    assert.match(cypressSeed, /\(87,'7\.6\.2',[^;]+\);/);
});

test('logout invalidates server state and expires the scoped browser cookie', async () => {
    const authenticationManager = await read('src/ChurchCRM/Authentication/AuthenticationManager.php');

    assert.match(authenticationManager, /session_destroy\(\)/);
    assert.match(authenticationManager, /setcookie\(session_name\(\), '', \[/);
    assert.match(authenticationManager, /'path' => \$cookieParameters\['path'\]/);
    assert.match(authenticationManager, /unset\(\$_COOKIE\[session_name\(\)\]\)/);
});

test('kiosk bearer cookies are secure on proxied HTTPS requests', async () => {
    const kiosk = await read('src/kiosk/index.php');

    assert.match(kiosk, /HTTP_X_FORWARDED_PROTO/);
    assert.equal((kiosk.match(/'secure'\s*=>\s*\$isHttps/g) || []).length, 2);
    assert.equal((kiosk.match(/setcookie\('kioskCookie'/g) || []).length, 2);
});

test('plugins provision their own tables on enable, never via a release migration', async () => {
    const [manifest, schema, pluginManager, abstractPlugin, install, upgradeJson] = await Promise.all([
        read('src/plugins/core/signup-sheets/plugin.json'),
        read('src/plugins/core/signup-sheets/schema/install.sql'),
        read('src/ChurchCRM/Plugin/PluginManager.php'),
        read('src/ChurchCRM/Plugin/AbstractPlugin.php'),
        read('src/mysql/install/Install.sql'),
        read('src/mysql/upgrade.json'),
    ]);
    const plugin = JSON.parse(manifest);

    // UpgradeService returns early when the database version already equals the
    // installed version, so a plugin whose schema rode on a release migration
    // would never reach databases already at that release.
    assert.equal(plugin.schemaFile, 'schema/install.sql');
    assert.deepEqual(plugin.requiredTables, [
        'signupsheet_shs',
        'signupslot_sls',
        'signupclaim_sgc',
        'signupaudit_sga',
    ]);

    for (const table of plugin.requiredTables) {
        assert.match(schema, new RegExp('CREATE TABLE IF NOT EXISTS `' + table + '`'));
        assert.doesNotMatch(install, new RegExp('`' + table + '`'));
        assert.doesNotMatch(upgradeJson, new RegExp(table));
    }

    // The schema runs on every enable, so it must never destroy existing data.
    assert.doesNotMatch(schema, /DROP\s+(?:COLUMN|TABLE)/i);

    assert.match(abstractPlugin, /public function installSchema\(\): void/);
    assert.match(abstractPlugin, /SQLUtils::sqlImport\(\$schemaFile, Propel::getWriteConnection\('default'\)\)/);
    assert.match(abstractPlugin, /public function getMissingTables\(\): array/);

    // A verification gate that cannot verify must fail closed: returning an
    // empty array on a query error would read as "nothing missing" and let
    // enablePlugin() record the plugin as enabled over an unknown schema.
    assert.match(abstractPlugin, /throw new .{1,2}RuntimeException\(\s*"Unable to verify tables for plugin/);

    // Enable applies the schema and verifies it before the plugin is recorded
    // as enabled, so a half-created schema can never present as a working plugin.
    const enableBlock = pluginManager.match(
        /public static function enablePlugin\(string \$pluginId\): bool[\s\S]*?\n    \}/,
    );
    assert.ok(enableBlock, 'enablePlugin must exist');
    const enableBody = enableBlock[0];
    assert.ok(
        enableBody.indexOf('$plugin->installSchema()') < enableBody.indexOf('$plugin->activate()'),
        'schema must be installed before the activate hook',
    );
    assert.ok(
        enableBody.indexOf('getMissingTables()') < enableBody.indexOf("SystemConfig::setValue($enabledKey, '1')"),
        'missing tables must be detected before the plugin is marked enabled',
    );
    assert.match(enableBody, /is missing required tables/);
});
