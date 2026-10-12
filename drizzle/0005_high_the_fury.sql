CREATE TABLE `document_sequences` (
	`id` int AUTO_INCREMENT NOT NULL,
	`prefix` varchar(12) NOT NULL,
	`year` int NOT NULL,
	`next_value` int NOT NULL DEFAULT 1,
	CONSTRAINT `document_sequences_id` PRIMARY KEY(`id`),
	CONSTRAINT `sequence_prefix_year` UNIQUE(`prefix`,`year`),
	CONSTRAINT `sequence_positive` CHECK(`document_sequences`.`next_value` > 0)
);
--> statement-breakpoint
CREATE TABLE `operation_keys` (
	`id` int AUTO_INCREMENT NOT NULL,
	`actor_id` int NOT NULL,
	`operation` varchar(80) NOT NULL,
	`request_key` varchar(100) NOT NULL,
	`payload_hash` varchar(64) NOT NULL,
	`result` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `operation_keys_id` PRIMARY KEY(`id`),
	CONSTRAINT `operation_actor_key` UNIQUE(`actor_id`,`operation`,`request_key`)
);
--> statement-breakpoint
CREATE TABLE `scm_audit_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`actor_id` int NOT NULL,
	`action` varchar(100) NOT NULL,
	`entity_type` varchar(80) NOT NULL,
	`entity_id` int NOT NULL,
	`before_value` json,
	`after_value` json,
	`reason` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `scm_audit_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `scm_outbox` (
	`id` int AUTO_INCREMENT NOT NULL,
	`event_id` varchar(36) NOT NULL,
	`event_type` varchar(100) NOT NULL,
	`entity_type` varchar(80) NOT NULL,
	`entity_id` int NOT NULL,
	`payload` json NOT NULL,
	`status` enum('pending','processing','sent','failed') NOT NULL DEFAULT 'pending',
	`attempts` int NOT NULL DEFAULT 0,
	`next_attempt_at` datetime,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `scm_outbox_id` PRIMARY KEY(`id`),
	CONSTRAINT `scm_outbox_event_id_unique` UNIQUE(`event_id`)
);
--> statement-breakpoint
CREATE TABLE `scm_branches` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(40) NOT NULL,
	`name_ar` varchar(200) NOT NULL,
	`name_en` varchar(200) NOT NULL,
	`name_ur` varchar(200) NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	`version` int NOT NULL DEFAULT 1,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`address` text,
	CONSTRAINT `scm_branches_id` PRIMARY KEY(`id`),
	CONSTRAINT `scm_branches_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `scm_categories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(40) NOT NULL,
	`name_ar` varchar(200) NOT NULL,
	`name_en` varchar(200) NOT NULL,
	`name_ur` varchar(200) NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	`version` int NOT NULL DEFAULT 1,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`parent_id` int,
	CONSTRAINT `scm_categories_id` PRIMARY KEY(`id`),
	CONSTRAINT `scm_categories_code_unique` UNIQUE(`code`),
	CONSTRAINT `category_not_self` CHECK(`scm_categories`.`parent_id` IS NULL OR `scm_categories`.`parent_id` <> `scm_categories`.`id`)
);
--> statement-breakpoint
CREATE TABLE `scm_cost_centers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(40) NOT NULL,
	`name_ar` varchar(200) NOT NULL,
	`name_en` varchar(200) NOT NULL,
	`name_ur` varchar(200) NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	`version` int NOT NULL DEFAULT 1,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`branch_id` int NOT NULL,
	CONSTRAINT `scm_cost_centers_id` PRIMARY KEY(`id`),
	CONSTRAINT `scm_cost_centers_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `scm_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(40) NOT NULL,
	`name_ar` varchar(200) NOT NULL,
	`name_en` varchar(200) NOT NULL,
	`name_ur` varchar(200) NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	`version` int NOT NULL DEFAULT 1,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`type` enum('inventory','consumable','service','asset','non_stock') NOT NULL,
	`category_id` int NOT NULL,
	`base_uom_id` int NOT NULL,
	`purchasing_uom_id` int NOT NULL,
	`description` text,
	`barcode` varchar(100),
	`track_inventory` boolean NOT NULL DEFAULT false,
	`inspection_required` boolean NOT NULL DEFAULT false,
	`lot_tracking` boolean NOT NULL DEFAULT false,
	`serial_tracking` boolean NOT NULL DEFAULT false,
	`expiry_tracking` boolean NOT NULL DEFAULT false,
	CONSTRAINT `scm_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `scm_items_code_unique` UNIQUE(`code`),
	CONSTRAINT `scm_items_barcode_unique` UNIQUE(`barcode`),
	CONSTRAINT `service_non_inventory` CHECK(`scm_items`.`type` <> 'service' OR `scm_items`.`track_inventory` = 0),
	CONSTRAINT `tracking_requires_inventory` CHECK(`scm_items`.`track_inventory` = 1 OR (`scm_items`.`lot_tracking` = 0 AND `scm_items`.`serial_tracking` = 0 AND `scm_items`.`expiry_tracking` = 0)),
	CONSTRAINT `expiry_requires_lot` CHECK(`scm_items`.`expiry_tracking` = 0 OR `scm_items`.`lot_tracking` = 1)
);
--> statement-breakpoint
CREATE TABLE `scm_sites` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(40) NOT NULL,
	`name_ar` varchar(200) NOT NULL,
	`name_en` varchar(200) NOT NULL,
	`name_ur` varchar(200) NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	`version` int NOT NULL DEFAULT 1,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`branch_id` int NOT NULL,
	`address` text,
	CONSTRAINT `scm_sites_id` PRIMARY KEY(`id`),
	CONSTRAINT `scm_sites_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `scm_units` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(40) NOT NULL,
	`name_ar` varchar(200) NOT NULL,
	`name_en` varchar(200) NOT NULL,
	`name_ur` varchar(200) NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	`version` int NOT NULL DEFAULT 1,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`dimension` enum('count','mass','length','area','volume','time') NOT NULL,
	CONSTRAINT `scm_units_id` PRIMARY KEY(`id`),
	CONSTRAINT `scm_units_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `scm_uom_conversions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(40) NOT NULL,
	`name_ar` varchar(200) NOT NULL,
	`name_en` varchar(200) NOT NULL,
	`name_ur` varchar(200) NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	`version` int NOT NULL DEFAULT 1,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`item_id` int NOT NULL,
	`from_uom_id` int NOT NULL,
	`to_uom_id` int NOT NULL,
	`factor` decimal(18,6) NOT NULL,
	CONSTRAINT `scm_uom_conversions_id` PRIMARY KEY(`id`),
	CONSTRAINT `scm_uom_conversions_code_unique` UNIQUE(`code`),
	CONSTRAINT `item_conversion_pair` UNIQUE(`item_id`,`from_uom_id`,`to_uom_id`),
	CONSTRAINT `conversion_positive` CHECK(`scm_uom_conversions`.`factor` > 0),
	CONSTRAINT `conversion_distinct` CHECK(`scm_uom_conversions`.`from_uom_id` <> `scm_uom_conversions`.`to_uom_id`)
);
--> statement-breakpoint
CREATE TABLE `scm_warehouse_locations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(40) NOT NULL,
	`name_ar` varchar(200) NOT NULL,
	`name_en` varchar(200) NOT NULL,
	`name_ur` varchar(200) NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	`version` int NOT NULL DEFAULT 1,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`warehouse_id` int NOT NULL,
	`type` enum('receiving','inspection','quarantine','storage') NOT NULL,
	CONSTRAINT `scm_warehouse_locations_id` PRIMARY KEY(`id`),
	CONSTRAINT `scm_warehouse_locations_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `scm_warehouses` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(40) NOT NULL,
	`name_ar` varchar(200) NOT NULL,
	`name_en` varchar(200) NOT NULL,
	`name_ur` varchar(200) NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	`version` int NOT NULL DEFAULT 1,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`site_id` int NOT NULL,
	CONSTRAINT `scm_warehouses_id` PRIMARY KEY(`id`),
	CONSTRAINT `scm_warehouses_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
ALTER TABLE `operation_keys` ADD CONSTRAINT `operation_keys_actor_id_users_id_fk` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_audit_events` ADD CONSTRAINT `scm_audit_events_actor_id_users_id_fk` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_categories` ADD CONSTRAINT `scm_categories_parent_id_scm_categories_id_fk` FOREIGN KEY (`parent_id`) REFERENCES `scm_categories`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_cost_centers` ADD CONSTRAINT `scm_cost_centers_branch_id_scm_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `scm_branches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_items` ADD CONSTRAINT `scm_items_category_id_scm_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `scm_categories`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_items` ADD CONSTRAINT `scm_items_base_uom_id_scm_units_id_fk` FOREIGN KEY (`base_uom_id`) REFERENCES `scm_units`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_items` ADD CONSTRAINT `scm_items_purchasing_uom_id_scm_units_id_fk` FOREIGN KEY (`purchasing_uom_id`) REFERENCES `scm_units`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_sites` ADD CONSTRAINT `scm_sites_branch_id_scm_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `scm_branches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_uom_conversions` ADD CONSTRAINT `scm_uom_conversions_item_id_scm_items_id_fk` FOREIGN KEY (`item_id`) REFERENCES `scm_items`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_uom_conversions` ADD CONSTRAINT `scm_uom_conversions_from_uom_id_scm_units_id_fk` FOREIGN KEY (`from_uom_id`) REFERENCES `scm_units`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_uom_conversions` ADD CONSTRAINT `scm_uom_conversions_to_uom_id_scm_units_id_fk` FOREIGN KEY (`to_uom_id`) REFERENCES `scm_units`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_warehouse_locations` ADD CONSTRAINT `scm_warehouse_locations_warehouse_id_scm_warehouses_id_fk` FOREIGN KEY (`warehouse_id`) REFERENCES `scm_warehouses`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_warehouses` ADD CONSTRAINT `scm_warehouses_site_id_scm_sites_id_fk` FOREIGN KEY (`site_id`) REFERENCES `scm_sites`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `scm_audit_entity` ON `scm_audit_events` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `scm_audit_actor_time` ON `scm_audit_events` (`actor_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `outbox_dispatch` ON `scm_outbox` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `category_parent` ON `scm_categories` (`parent_id`);--> statement-breakpoint
CREATE INDEX `cost_center_branch` ON `scm_cost_centers` (`branch_id`);--> statement-breakpoint
CREATE INDEX `item_category` ON `scm_items` (`category_id`);--> statement-breakpoint
CREATE INDEX `item_base_uom` ON `scm_items` (`base_uom_id`);--> statement-breakpoint
CREATE INDEX `item_purchase_uom` ON `scm_items` (`purchasing_uom_id`);--> statement-breakpoint
CREATE INDEX `site_branch` ON `scm_sites` (`branch_id`);--> statement-breakpoint
CREATE INDEX `conversion_to_uom` ON `scm_uom_conversions` (`to_uom_id`);--> statement-breakpoint
CREATE INDEX `location_warehouse` ON `scm_warehouse_locations` (`warehouse_id`);--> statement-breakpoint
CREATE INDEX `warehouse_site` ON `scm_warehouses` (`site_id`);