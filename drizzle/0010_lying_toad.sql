CREATE TABLE `p1_certificates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`number` varchar(50) NOT NULL,
	`contract_id` int NOT NULL,
	`certificate_date` varchar(10) NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'pending',
	`quantities` json NOT NULL,
	`progress` decimal(7,4) NOT NULL,
	`cumulative_gross` decimal(18,2) NOT NULL,
	`previous_gross` decimal(18,2) NOT NULL,
	`gross` decimal(18,2) NOT NULL,
	`tax` decimal(18,2) NOT NULL,
	`retention` decimal(18,2) NOT NULL,
	`penalty` decimal(18,2) NOT NULL,
	`delay_days` int NOT NULL,
	`other_deduction` decimal(18,2) NOT NULL,
	`deduction_reason` text NOT NULL,
	`net` decimal(18,2) NOT NULL,
	`notes` text NOT NULL,
	`decision_reason` text,
	`decided_by` int,
	`decided_at` timestamp,
	`released_amount` decimal(18,2) NOT NULL DEFAULT '0',
	`released_by` int,
	`release_reason` text,
	`created_by` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `p1_certificates_id` PRIMARY KEY(`id`),
	CONSTRAINT `p1_certificates_number_unique` UNIQUE(`number`)
);
--> statement-breakpoint
CREATE TABLE `p1_company` (
	`id` int NOT NULL,
	`data` json NOT NULL,
	CONSTRAINT `p1_company_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `p1_contracts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`number` varchar(50) NOT NULL,
	`project_id` int NOT NULL,
	`supplier_id` int NOT NULL,
	`title` varchar(255) NOT NULL,
	`reference` varchar(100) NOT NULL,
	`contract_date` varchar(10) NOT NULL,
	`site_date` varchar(10) NOT NULL,
	`duration_days` int NOT NULL,
	`warranty_months` int NOT NULL,
	`scope` text NOT NULL,
	`terms` text NOT NULL,
	`items` json NOT NULL,
	`subtotal` decimal(18,2) NOT NULL,
	`total` decimal(18,2) NOT NULL,
	`retention_percent` decimal(7,4) NOT NULL,
	`tax_percent` decimal(7,4) NOT NULL,
	`daily_penalty` decimal(18,2) NOT NULL,
	`currency` varchar(8) NOT NULL DEFAULT 'SAR',
	`created_by` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `p1_contracts_id` PRIMARY KEY(`id`),
	CONSTRAINT `p1_contracts_number_unique` UNIQUE(`number`)
);
--> statement-breakpoint
CREATE TABLE `p1_milestones` (
	`id` int AUTO_INCREMENT NOT NULL,
	`contract_id` int NOT NULL,
	`position` int NOT NULL,
	`name` varchar(150) NOT NULL,
	`percent` decimal(7,4) NOT NULL,
	`amount` decimal(18,2) NOT NULL,
	`due_date` varchar(10) NOT NULL,
	`min_progress` decimal(7,4) NOT NULL,
	CONSTRAINT `p1_milestones_id` PRIMARY KEY(`id`),
	CONSTRAINT `p1_milestone_position_unique` UNIQUE(`contract_id`,`position`)
);
--> statement-breakpoint
CREATE TABLE `p1_payments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`contract_id` int NOT NULL,
	`certificate_id` int NOT NULL,
	`milestone_id` int,
	`kind` varchar(20) NOT NULL,
	`amount` decimal(18,2) NOT NULL,
	`payment_date` varchar(10) NOT NULL,
	`voucher` varchar(100) NOT NULL,
	`voucher_key` varchar(110) NOT NULL,
	`notes` text NOT NULL,
	`created_by` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `p1_payments_id` PRIMARY KEY(`id`),
	CONSTRAINT `p1_payments_voucher_key_unique` UNIQUE(`voucher_key`)
);
--> statement-breakpoint
CREATE TABLE `p1_projects` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`site` varchar(255) NOT NULL,
	`created_by` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `p1_projects_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `p1_certificates` ADD CONSTRAINT `p1_certificates_contract_id_p1_contracts_id_fk` FOREIGN KEY (`contract_id`) REFERENCES `p1_contracts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `p1_certificates` ADD CONSTRAINT `p1_certificates_decided_by_users_id_fk` FOREIGN KEY (`decided_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `p1_certificates` ADD CONSTRAINT `p1_certificates_released_by_users_id_fk` FOREIGN KEY (`released_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `p1_certificates` ADD CONSTRAINT `p1_certificates_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `p1_contracts` ADD CONSTRAINT `p1_contracts_project_id_p1_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `p1_projects`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `p1_contracts` ADD CONSTRAINT `p1_contracts_supplier_id_suppliers_id_fk` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `p1_contracts` ADD CONSTRAINT `p1_contracts_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `p1_milestones` ADD CONSTRAINT `p1_milestones_contract_id_p1_contracts_id_fk` FOREIGN KEY (`contract_id`) REFERENCES `p1_contracts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `p1_payments` ADD CONSTRAINT `p1_payments_contract_id_p1_contracts_id_fk` FOREIGN KEY (`contract_id`) REFERENCES `p1_contracts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `p1_payments` ADD CONSTRAINT `p1_payments_certificate_id_p1_certificates_id_fk` FOREIGN KEY (`certificate_id`) REFERENCES `p1_certificates`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `p1_payments` ADD CONSTRAINT `p1_payments_milestone_id_p1_milestones_id_fk` FOREIGN KEY (`milestone_id`) REFERENCES `p1_milestones`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `p1_payments` ADD CONSTRAINT `p1_payments_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `p1_projects` ADD CONSTRAINT `p1_projects_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `p1_certificate_contract_idx` ON `p1_certificates` (`contract_id`);--> statement-breakpoint
CREATE INDEX `p1_contract_supplier_idx` ON `p1_contracts` (`supplier_id`);--> statement-breakpoint
CREATE INDEX `p1_payment_contract_idx` ON `p1_payments` (`contract_id`);