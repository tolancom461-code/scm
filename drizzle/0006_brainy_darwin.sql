CREATE TABLE `pm_material_catalog_entries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`source_key` varchar(64) NOT NULL,
	`external_id` varchar(160) NOT NULL,
	`catalog_code` varchar(255) NOT NULL,
	`item_name` varchar(255) NOT NULL,
	`unit_id` int NOT NULL,
	`unit_snapshot` text NOT NULL,
	`specifications` text NOT NULL,
	`image_storage_key` varchar(500),
	`image_mime_type` varchar(40),
	`image_checksum` varchar(64),
	`created_by` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `pm_material_catalog_entries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `pm_material_requisitions` MODIFY COLUMN `approved_snapshot` mediumtext;--> statement-breakpoint
ALTER TABLE `pm_material_units` MODIFY COLUMN `code` varchar(100) NOT NULL;--> statement-breakpoint
ALTER TABLE `pm_material_requisition_items` ADD `catalog_entry_id` int;--> statement-breakpoint
ALTER TABLE `pm_material_requisition_items` ADD `catalog_code` varchar(255) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `pm_material_catalog_entries` ADD CONSTRAINT `pm_catalog_unit_fk` FOREIGN KEY (`unit_id`) REFERENCES `pm_material_units`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `pm_material_catalog_entries` ADD CONSTRAINT `pm_catalog_creator_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `pm_catalog_external_idx` ON `pm_material_catalog_entries` (`source_key`,`external_id`);--> statement-breakpoint
ALTER TABLE `pm_material_requisition_items` ADD CONSTRAINT `pm_mr_item_catalog_fk` FOREIGN KEY (`catalog_entry_id`) REFERENCES `pm_material_catalog_entries`(`id`) ON DELETE no action ON UPDATE no action;