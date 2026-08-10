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
