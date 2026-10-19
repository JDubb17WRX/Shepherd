<?php

use ChurchCRM\dto\SystemURLs;
use ChurchCRM\Service\AppIntegrityService;

require '/var/www/html/shepherd/vendor/autoload.php';
SystemURLs::init('/shepherd', ['https://preview.example.invalid'], '/var/www/html/shepherd');
$result = AppIntegrityService::verifyApplicationIntegrity();
if ($result['status'] !== 'success') {
    throw new RuntimeException('Packaged file signatures do not match: ' . json_encode($result));
}
$orphans = AppIntegrityService::getOrphanedFiles();
if ($orphans !== []) {
    throw new RuntimeException('Unexpected packaged files: ' . json_encode($orphans));
}
echo "Packaged application signatures and file inventory verified.\n";
