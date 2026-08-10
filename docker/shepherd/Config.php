<?php

$sSERVERNAME = getenv('SHEPHERD_DB_HOST') ?: 'database';
$dbPort = getenv('SHEPHERD_DB_PORT') ?: '3306';
$sUSER = getenv('SHEPHERD_DB_USER') ?: 'shepherd';
$sPASSWORD = getenv('SHEPHERD_DB_PASSWORD') ?: '';
$sDATABASE = getenv('SHEPHERD_DB_NAME') ?: 'shepherd';
$sRootPath = '/shepherd';
$bLockURL = false;
$publicUrl = rtrim(getenv('SHEPHERD_PUBLIC_URL') ?: 'https://eprpcna.rpcnacovenanters.com', '/');
$URL[0] = $publicUrl . '/shepherd/';
error_reporting(E_ERROR);

require_once __DIR__ . '/LoadConfigs.php';
