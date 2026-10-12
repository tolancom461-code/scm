ALTER TABLE `p1_contracts` MODIFY COLUMN `warranty_months` int NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE `p1_contracts` ADD `warranty_days` int NULL;--> statement-breakpoint
UPDATE `p1_contracts` SET `warranty_days` = DATEDIFF(DATE_ADD(COALESCE(`handover_date`, `site_date`), INTERVAL `warranty_months` MONTH), COALESCE(`handover_date`, `site_date`));--> statement-breakpoint
ALTER TABLE `p1_contracts` MODIFY COLUMN `warranty_days` int DEFAULT 0 NOT NULL;
