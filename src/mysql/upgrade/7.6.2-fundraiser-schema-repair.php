<?php

use ChurchCRM\Utils\LoggerUtils;
use Propel\Runtime\Propel;

// Shepherd 7.6.2: repair installations whose version history reached 7.6.1
// without applying the 7.5.0 fundraiser fields migration. This can also safely
// resume a partially applied repair because every column is checked separately.
$fundraiserConnection = Propel::getConnection();
$fundraiserLogger = LoggerUtils::getAppLogger();

$fundraiserColumns = [
    'fr_EndDate' => 'DATE NULL AFTER `fr_EnteredDate`',
    'fr_Status' => "VARCHAR(15) NULL DEFAULT 'Active' AFTER `fr_EndDate`",
    'fr_GoalAmount' => 'DECIMAL(10, 2) NULL AFTER `fr_Status`',
    'fr_Type' => "VARCHAR(20) NULL DEFAULT 'Auction' AFTER `fr_GoalAmount`",
    'fr_fund_ID' => 'MEDIUMINT UNSIGNED NULL AFTER `fr_Type`',
];

$fundraiserColumnExists = static function (string $columnName) use ($fundraiserConnection): bool {
    $statement = $fundraiserConnection->prepare(
        'SELECT COUNT(*) FROM information_schema.COLUMNS'
        . ' WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :tableName AND COLUMN_NAME = :columnName'
    );
    $statement->execute([
        'tableName' => 'fundraiser_fr',
        'columnName' => $columnName,
    ]);

    return (int) $statement->fetchColumn() > 0;
};

$fundraiserAddedColumns = [];

foreach ($fundraiserColumns as $columnName => $definition) {
    if ($fundraiserColumnExists($columnName)) {
        $fundraiserLogger->info("Fundraiser schema repair: {$columnName} already exists");
        continue;
    }

    try {
        $fundraiserConnection->exec(
            "ALTER TABLE `fundraiser_fr` ADD COLUMN `{$columnName}` {$definition}"
        );
        $fundraiserAddedColumns[] = $columnName;
        $fundraiserLogger->info("Fundraiser schema repair: added {$columnName}");
    } catch (\Throwable $exception) {
        // Another request may have completed the same ALTER after our check.
        // Treat that race as success, but preserve every other database error.
        if (!$fundraiserColumnExists($columnName)) {
            throw $exception;
        }
        $fundraiserLogger->info("Fundraiser schema repair: {$columnName} was added concurrently");
    }
}

// Preserve the original 7.5.0 backfill semantics only when the relevant schema
// was repaired. A fully correct database remains a true no-op on this migration.
if (in_array('fr_EndDate', $fundraiserAddedColumns, true)) {
    $fundraiserConnection->exec(
        'UPDATE `fundraiser_fr` SET `fr_EndDate` = `fr_date` WHERE `fr_EndDate` IS NULL'
    );
}

if (
    in_array('fr_EndDate', $fundraiserAddedColumns, true)
    || in_array('fr_Status', $fundraiserAddedColumns, true)
) {
    $fundraiserConnection->exec(
        "UPDATE `fundraiser_fr` SET `fr_Status` = 'Closed'"
        . " WHERE `fr_EndDate` < CURDATE() AND `fr_Status` = 'Active'"
    );
}

$fundraiserLogger->info(
    'Fundraiser schema repair complete',
    ['addedColumns' => $fundraiserAddedColumns]
);
