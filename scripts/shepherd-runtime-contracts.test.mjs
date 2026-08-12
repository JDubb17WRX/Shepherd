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
    const [api, routes, service, repository, caddyfile, upgrades, migration, install] = await Promise.all([
        read('src/api/index.php'),
        read('src/api/routes/website-content.php'),
        read('src/ChurchCRM/Shepherd/WebsiteContentService.php'),
        read('src/ChurchCRM/Shepherd/WebsiteContentRepository.php'),
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
