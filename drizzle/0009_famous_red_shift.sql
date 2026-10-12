CREATE TABLE `scm_credit_lines` (
	`id` int AUTO_INCREMENT NOT NULL,
	`credit_id` int NOT NULL,
	`invoice_line_id` int NOT NULL,
	`quantity` decimal(18,6) NOT NULL,
	`total` decimal(18,2) NOT NULL,
	CONSTRAINT `scm_credit_lines_id` PRIMARY KEY(`id`),
	CONSTRAINT `credit_invoice_line` UNIQUE(`credit_id`,`invoice_line_id`),
	CONSTRAINT `credit_quantity_positive` CHECK(`scm_credit_lines`.`quantity`>0)
);
--> statement-breakpoint
CREATE TABLE `scm_credit_notes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`number` varchar(50) NOT NULL,
	`supplier_reference` varchar(100) NOT NULL,
	`invoice_id` int NOT NULL,
	`supplier_id` int NOT NULL,
	`return_id` int,
	`reason` text NOT NULL,
	`total` decimal(18,2) NOT NULL,
	`retention_credit` decimal(18,2) NOT NULL,
	`status` enum('pending','approved','rejected','returned') NOT NULL DEFAULT 'pending',
	`workflow_id` int,
	`created_by` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `scm_credit_notes_id` PRIMARY KEY(`id`),
	CONSTRAINT `scm_credit_notes_number_unique` UNIQUE(`number`),
	CONSTRAINT `credit_supplier_reference` UNIQUE(`supplier_id`,`supplier_reference`)
);
--> statement-breakpoint
CREATE TABLE `scm_invoice_lines` (
	`id` int AUTO_INCREMENT NOT NULL,
	`invoice_id` int NOT NULL,
	`order_line_id` int NOT NULL,
	`quantity` decimal(18,6) NOT NULL,
	`unit_price` decimal(18,2) NOT NULL,
	`discount_percent` decimal(7,4) NOT NULL,
	`tax_percent` decimal(7,4) NOT NULL,
	`subtotal` decimal(18,2) NOT NULL,
	`tax_amount` decimal(18,2) NOT NULL,
	`total` decimal(18,2) NOT NULL,
	CONSTRAINT `scm_invoice_lines_id` PRIMARY KEY(`id`),
	CONSTRAINT `invoice_order_line` UNIQUE(`invoice_id`,`order_line_id`),
	CONSTRAINT `invoice_line_positive` CHECK(`scm_invoice_lines`.`quantity`>0 AND `scm_invoice_lines`.`unit_price`>=0)
);
--> statement-breakpoint
CREATE TABLE `scm_invoice_matches` (
	`id` int AUTO_INCREMENT NOT NULL,
	`invoice_id` int NOT NULL,
	`invoice_line_id` int NOT NULL,
	`eligible_quantity` decimal(18,6) NOT NULL,
	`result` enum('matched','quantity_exceeded','price_mismatch','invalid_order') NOT NULL,
	`matched_by` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `scm_invoice_matches_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `scm_invoices` (
	`id` int AUTO_INCREMENT NOT NULL,
	`number` varchar(50) NOT NULL,
	`supplier_reference` varchar(100) NOT NULL,
	`supplier_id` int NOT NULL,
	`order_id` int NOT NULL,
	`currency` varchar(3) NOT NULL,
	`invoice_date` date NOT NULL,
	`due_date` date NOT NULL,
	`total` decimal(18,2) NOT NULL,
	`retention_percent` decimal(7,4) NOT NULL DEFAULT '0',
	`retention_amount` decimal(18,2) NOT NULL,
	`status` enum('draft','blocked','matched','pending','approved','rejected','returned','cancelled') NOT NULL DEFAULT 'draft',
	`workflow_id` int,
	`created_by` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `scm_invoices_id` PRIMARY KEY(`id`),
	CONSTRAINT `scm_invoices_number_unique` UNIQUE(`number`),
	CONSTRAINT `invoice_supplier_reference` UNIQUE(`supplier_id`,`supplier_reference`),
	CONSTRAINT `invoice_retention` CHECK(`scm_invoices`.`retention_percent` BETWEEN 0 AND 100 AND `scm_invoices`.`retention_amount`>=0 AND `scm_invoices`.`retention_amount`<=`scm_invoices`.`total`)
);
--> statement-breakpoint
CREATE TABLE `scm_payment_milestones` (
	`id` int AUTO_INCREMENT NOT NULL,
	`schedule_id` int NOT NULL,
	`position` int NOT NULL,
	`name_ar` varchar(255) NOT NULL,
	`name_en` varchar(255) NOT NULL,
	`name_ur` varchar(255) NOT NULL,
	`percent` decimal(7,4) NOT NULL,
	`amount` decimal(18,2) NOT NULL,
	`due_date` date NOT NULL,
	`condition` enum('advance','accepted','planting','warranty','manual') NOT NULL,
	`status` enum('planned','eligible') NOT NULL DEFAULT 'planned',
	`evidence` text,
	`condition_met_by` int,
	CONSTRAINT `scm_payment_milestones_id` PRIMARY KEY(`id`),
	CONSTRAINT `payment_schedule_position` UNIQUE(`schedule_id`,`position`),
	CONSTRAINT `milestone_values` CHECK(`scm_payment_milestones`.`percent`>0 AND `scm_payment_milestones`.`percent`<=100 AND `scm_payment_milestones`.`amount`>=0)
);
--> statement-breakpoint
CREATE TABLE `scm_payment_schedules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`order_id` int NOT NULL,
	`created_by` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `scm_payment_schedules_id` PRIMARY KEY(`id`),
	CONSTRAINT `scm_payment_schedules_order_id_unique` UNIQUE(`order_id`)
);
--> statement-breakpoint
CREATE TABLE `scm_payments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`number` varchar(50) NOT NULL,
	`order_id` int NOT NULL,
	`invoice_id` int,
	`milestone_id` int,
	`source_advance_id` int,
	`kind` enum('advance','invoice','recovery') NOT NULL,
	`amount` decimal(18,2) NOT NULL,
	`reference` varchar(150) NOT NULL,
	`status` enum('pending','posted','rejected','returned') NOT NULL DEFAULT 'pending',
	`workflow_id` int,
	`reason` text NOT NULL,
	`created_by` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `scm_payments_id` PRIMARY KEY(`id`),
	CONSTRAINT `scm_payments_number_unique` UNIQUE(`number`),
	CONSTRAINT `scm_payments_reference_unique` UNIQUE(`reference`),
	CONSTRAINT `payment_positive` CHECK(`scm_payments`.`amount`>0)
);
--> statement-breakpoint
CREATE TABLE `scm_retention_releases` (
	`id` int AUTO_INCREMENT NOT NULL,
	`invoice_id` int NOT NULL,
	`amount` decimal(18,2) NOT NULL,
	`evidence` text NOT NULL,
	`status` enum('pending','posted','rejected','returned') NOT NULL DEFAULT 'pending',
	`workflow_id` int,
	`created_by` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `scm_retention_releases_id` PRIMARY KEY(`id`),
	CONSTRAINT `scm_retention_releases_invoice_id_unique` UNIQUE(`invoice_id`)
);
--> statement-breakpoint
CREATE TABLE `scm_work_certificate_lines` (
	`id` int AUTO_INCREMENT NOT NULL,
	`certificate_id` int NOT NULL,
	`order_line_id` int NOT NULL,
	`quantity` decimal(18,6) NOT NULL,
	`total` decimal(18,2) NOT NULL,
	CONSTRAINT `scm_work_certificate_lines_id` PRIMARY KEY(`id`),
	CONSTRAINT `work_certificate_line` UNIQUE(`certificate_id`,`order_line_id`),
	CONSTRAINT `work_quantity_positive` CHECK(`scm_work_certificate_lines`.`quantity`>0)
);
--> statement-breakpoint
CREATE TABLE `scm_work_certificates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`number` varchar(50) NOT NULL,
	`order_id` int NOT NULL,
	`certificate_date` date NOT NULL,
	`evidence` text NOT NULL,
	`total` decimal(18,2) NOT NULL,
	`status` enum('pending','approved','rejected','returned') NOT NULL DEFAULT 'pending',
	`workflow_id` int,
	`created_by` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `scm_work_certificates_id` PRIMARY KEY(`id`),
	CONSTRAINT `scm_work_certificates_number_unique` UNIQUE(`number`)
);
--> statement-breakpoint
ALTER TABLE `scm_order_lines` MODIFY COLUMN `award_line_id` int;--> statement-breakpoint
ALTER TABLE `scm_orders` ADD `execution` enum('goods','works') DEFAULT 'goods' NOT NULL;--> statement-breakpoint
ALTER TABLE `scm_orders` ADD `title` varchar(255) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `scm_orders` ADD `contract_reference` varchar(100);--> statement-breakpoint
ALTER TABLE `scm_credit_lines` ADD CONSTRAINT `scm_credit_lines_credit_id_scm_credit_notes_id_fk` FOREIGN KEY (`credit_id`) REFERENCES `scm_credit_notes`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_credit_lines` ADD CONSTRAINT `scm_credit_lines_invoice_line_id_scm_invoice_lines_id_fk` FOREIGN KEY (`invoice_line_id`) REFERENCES `scm_invoice_lines`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_credit_notes` ADD CONSTRAINT `scm_credit_notes_invoice_id_scm_invoices_id_fk` FOREIGN KEY (`invoice_id`) REFERENCES `scm_invoices`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_credit_notes` ADD CONSTRAINT `scm_credit_notes_supplier_id_suppliers_id_fk` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_credit_notes` ADD CONSTRAINT `scm_credit_notes_return_id_scm_supplier_returns_id_fk` FOREIGN KEY (`return_id`) REFERENCES `scm_supplier_returns`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_credit_notes` ADD CONSTRAINT `scm_credit_notes_workflow_id_scm_workflow_instances_id_fk` FOREIGN KEY (`workflow_id`) REFERENCES `scm_workflow_instances`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_credit_notes` ADD CONSTRAINT `scm_credit_notes_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_invoice_lines` ADD CONSTRAINT `scm_invoice_lines_invoice_id_scm_invoices_id_fk` FOREIGN KEY (`invoice_id`) REFERENCES `scm_invoices`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_invoice_lines` ADD CONSTRAINT `scm_invoice_lines_order_line_id_scm_order_lines_id_fk` FOREIGN KEY (`order_line_id`) REFERENCES `scm_order_lines`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_invoice_matches` ADD CONSTRAINT `scm_invoice_matches_invoice_id_scm_invoices_id_fk` FOREIGN KEY (`invoice_id`) REFERENCES `scm_invoices`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_invoice_matches` ADD CONSTRAINT `scm_invoice_matches_invoice_line_id_scm_invoice_lines_id_fk` FOREIGN KEY (`invoice_line_id`) REFERENCES `scm_invoice_lines`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_invoice_matches` ADD CONSTRAINT `scm_invoice_matches_matched_by_users_id_fk` FOREIGN KEY (`matched_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_invoices` ADD CONSTRAINT `scm_invoices_supplier_id_suppliers_id_fk` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_invoices` ADD CONSTRAINT `scm_invoices_order_id_scm_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `scm_orders`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_invoices` ADD CONSTRAINT `scm_invoices_workflow_id_scm_workflow_instances_id_fk` FOREIGN KEY (`workflow_id`) REFERENCES `scm_workflow_instances`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_invoices` ADD CONSTRAINT `scm_invoices_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_payment_milestones` ADD CONSTRAINT `scm_payment_milestones_schedule_id_scm_payment_schedules_id_fk` FOREIGN KEY (`schedule_id`) REFERENCES `scm_payment_schedules`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_payment_milestones` ADD CONSTRAINT `scm_payment_milestones_condition_met_by_users_id_fk` FOREIGN KEY (`condition_met_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_payment_schedules` ADD CONSTRAINT `scm_payment_schedules_order_id_scm_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `scm_orders`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_payment_schedules` ADD CONSTRAINT `scm_payment_schedules_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_payments` ADD CONSTRAINT `scm_payments_order_id_scm_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `scm_orders`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_payments` ADD CONSTRAINT `scm_payments_invoice_id_scm_invoices_id_fk` FOREIGN KEY (`invoice_id`) REFERENCES `scm_invoices`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_payments` ADD CONSTRAINT `scm_payments_milestone_id_scm_payment_milestones_id_fk` FOREIGN KEY (`milestone_id`) REFERENCES `scm_payment_milestones`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_payments` ADD CONSTRAINT `scm_payments_source_advance_id_scm_payments_id_fk` FOREIGN KEY (`source_advance_id`) REFERENCES `scm_payments`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_payments` ADD CONSTRAINT `scm_payments_workflow_id_scm_workflow_instances_id_fk` FOREIGN KEY (`workflow_id`) REFERENCES `scm_workflow_instances`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_payments` ADD CONSTRAINT `scm_payments_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_retention_releases` ADD CONSTRAINT `scm_retention_releases_invoice_id_scm_invoices_id_fk` FOREIGN KEY (`invoice_id`) REFERENCES `scm_invoices`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_retention_releases` ADD CONSTRAINT `scm_retention_releases_workflow_id_scm_workflow_instances_id_fk` FOREIGN KEY (`workflow_id`) REFERENCES `scm_workflow_instances`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_retention_releases` ADD CONSTRAINT `scm_retention_releases_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_work_certificate_lines` ADD CONSTRAINT `work_line_certificate_fk` FOREIGN KEY (`certificate_id`) REFERENCES `scm_work_certificates`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_work_certificate_lines` ADD CONSTRAINT `work_line_order_fk` FOREIGN KEY (`order_line_id`) REFERENCES `scm_order_lines`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_work_certificates` ADD CONSTRAINT `scm_work_certificates_order_id_scm_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `scm_orders`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_work_certificates` ADD CONSTRAINT `scm_work_certificates_workflow_id_scm_workflow_instances_id_fk` FOREIGN KEY (`workflow_id`) REFERENCES `scm_workflow_instances`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_work_certificates` ADD CONSTRAINT `scm_work_certificates_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `invoice_match_history` ON `scm_invoice_matches` (`invoice_id`,`id`);--> statement-breakpoint
CREATE INDEX `invoice_order_status` ON `scm_invoices` (`order_id`,`status`);--> statement-breakpoint
CREATE INDEX `payment_invoice_status` ON `scm_payments` (`invoice_id`,`status`);--> statement-breakpoint
CREATE INDEX `payment_advance_status` ON `scm_payments` (`source_advance_id`,`status`);