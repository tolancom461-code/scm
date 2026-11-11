CREATE TABLE `pm_material_requisition_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`requisition_id` int NOT NULL,
	`sequence` int NOT NULL,
	`item_name` varchar(255) NOT NULL,
	`quantity` decimal(18,9) NOT NULL,
	`unit_id` int NOT NULL,
	`specifications` text NOT NULL,
	`notes` text NOT NULL,
	`need_date` varchar(10) NOT NULL,
	`lead_days` int NOT NULL,
	CONSTRAINT `pm_material_requisition_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `pm_material_req_item_sequence` UNIQUE(`requisition_id`,`sequence`)
);
--> statement-breakpoint
CREATE TABLE `pm_material_requisitions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`number` varchar(50) NOT NULL,
	`project_id` int NOT NULL,
	`task_id` int,
	`status` varchar(30) NOT NULL DEFAULT 'draft',
	`external_status` varchar(40),
	`external_pr_number` varchar(100),
	`external_reference_url` varchar(700),
	`external_message` text,
	`approved_snapshot` text,
	`created_by` int NOT NULL,
	`approved_by` int,
	`approved_at` timestamp,
	`external_updated_at` timestamp,
	`version` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `pm_material_requisitions_id` PRIMARY KEY(`id`),
	CONSTRAINT `pm_material_requisitions_number_unique` UNIQUE(`number`)
);
--> statement-breakpoint
CREATE TABLE `pm_material_units` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(30) NOT NULL,
	`name_ar` varchar(100) NOT NULL,
	`name_en` varchar(100) NOT NULL,
	`name_ur` varchar(100) NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	`version` int NOT NULL DEFAULT 0,
	CONSTRAINT `pm_material_units_id` PRIMARY KEY(`id`),
	CONSTRAINT `pm_material_units_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
ALTER TABLE `pm_material_requisition_items` ADD CONSTRAINT `pm_mr_item_request_fk` FOREIGN KEY (`requisition_id`) REFERENCES `pm_material_requisitions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `pm_material_requisition_items` ADD CONSTRAINT `pm_mr_item_unit_fk` FOREIGN KEY (`unit_id`) REFERENCES `pm_material_units`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `pm_material_requisitions` ADD CONSTRAINT `pm_material_requisitions_project_id_pm_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `pm_projects`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `pm_material_requisitions` ADD CONSTRAINT `pm_material_requisitions_task_id_pm_tasks_id_fk` FOREIGN KEY (`task_id`) REFERENCES `pm_tasks`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `pm_material_requisitions` ADD CONSTRAINT `pm_material_requisitions_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `pm_material_requisitions` ADD CONSTRAINT `pm_material_requisitions_approved_by_users_id_fk` FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `pm_material_req_item_date_idx` ON `pm_material_requisition_items` (`need_date`);--> statement-breakpoint
CREATE INDEX `pm_material_req_project_idx` ON `pm_material_requisitions` (`project_id`);--> statement-breakpoint
CREATE INDEX `pm_material_req_task_idx` ON `pm_material_requisitions` (`task_id`);--> statement-breakpoint
CREATE INDEX `pm_material_req_status_idx` ON `pm_material_requisitions` (`status`);
