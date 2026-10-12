-- Run migrations with application writers stopped. Preserve issued document numbers.
SET time_zone = '+00:00';
--> statement-breakpoint
ALTER TABLE `p1_projects` ADD `number` varchar(50);
--> statement-breakpoint
UPDATE `p1_projects` AS p
JOIN (
  SELECT `id`,
    YEAR(DATE_ADD(`created_at`, INTERVAL 3 HOUR)) AS issue_year,
    DATE_FORMAT(DATE_ADD(`created_at`, INTERVAL 3 HOUR), '%y-%m') AS issue_period,
    ROW_NUMBER() OVER (
      PARTITION BY YEAR(DATE_ADD(`created_at`, INTERVAL 3 HOUR))
      ORDER BY `created_at`, `id`
    ) AS serial
  FROM `p1_projects`
) AS numbered ON numbered.id = p.id
LEFT JOIN `document_sequences` AS seq
  ON seq.prefix = 'PRJ' AND seq.year = numbered.issue_year
SET p.number = CONCAT('PRJ-', numbered.issue_period, '-',
  LPAD(numbered.serial + COALESCE(seq.next_value - 1, 0),
    GREATEST(4, LENGTH(numbered.serial + COALESCE(seq.next_value - 1, 0))), '0'))
WHERE p.number IS NULL;
--> statement-breakpoint
INSERT INTO `document_sequences` (`prefix`, `year`, `next_value`)
SELECT 'PRJ', YEAR(DATE_ADD(`created_at`, INTERVAL 3 HOUR)),
  MAX(CAST(SUBSTRING_INDEX(`number`, '-', -1) AS UNSIGNED)) + 1
FROM `p1_projects`
GROUP BY YEAR(DATE_ADD(`created_at`, INTERVAL 3 HOUR))
ON DUPLICATE KEY UPDATE `next_value` = GREATEST(`next_value`, VALUES(`next_value`));
--> statement-breakpoint
ALTER TABLE `p1_projects` MODIFY COLUMN `number` varchar(50) NOT NULL;
--> statement-breakpoint
ALTER TABLE `p1_projects` ADD CONSTRAINT `p1_projects_number_unique` UNIQUE(`number`);
