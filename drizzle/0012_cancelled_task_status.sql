UPDATE `pm_task_statuses` AS `legacy`
LEFT JOIN `pm_task_statuses` AS `standard` ON `standard`.`code` = 'cancelled'
SET `legacy`.`code` = 'cancelled'
WHERE `legacy`.`name` = 'ملغاة'
  AND `legacy`.`code` LIKE 'custom-%'
  AND `standard`.`id` IS NULL;
--> statement-breakpoint
INSERT INTO `pm_task_statuses` (`code`, `name`)
VALUES ('cancelled', 'ملغاة')
ON DUPLICATE KEY UPDATE `id` = `id`;
