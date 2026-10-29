CREATE TABLE `documents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`documentNumber` varchar(50) NOT NULL,
	`entityType` varchar(60) NOT NULL,
	`entityId` int NOT NULL,
	`title` varchar(255) NOT NULL,
	`fileName` varchar(255) NOT NULL,
	`storageKey` varchar(500) NOT NULL,
	`url` varchar(700) NOT NULL,
	`mimeType` varchar(120) NOT NULL,
	`sizeBytes` int NOT NULL,
	`checksum` varchar(128) NOT NULL,
	`documentClassification` enum('normal','internal','confidential','highly_confidential') NOT NULL DEFAULT 'internal',
	`version` int NOT NULL DEFAULT 1,
	`uploadedBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `documents_id` PRIMARY KEY(`id`),
	CONSTRAINT `documents_documentNumber_unique` UNIQUE(`documentNumber`)
);
--> statement-breakpoint
CREATE TABLE `permissions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(120) NOT NULL,
	`module` varchar(60) NOT NULL,
	`action` varchar(60) NOT NULL,
	`labelAr` varchar(255) NOT NULL,
	`labelEn` varchar(255) NOT NULL,
	`labelUr` varchar(255) NOT NULL,
	CONSTRAINT `permissions_id` PRIMARY KEY(`id`),
	CONSTRAINT `permissions_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`tokenHash` varchar(128) NOT NULL,
	`expiresAt` datetime NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `sessions_tokenHash_unique` UNIQUE(`tokenHash`)
);
--> statement-breakpoint
CREATE TABLE `suppliers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`supplierNumber` varchar(40) NOT NULL,
	`nameAr` varchar(255) NOT NULL,
	`nameEn` varchar(255),
	`nameUr` varchar(255),
	`commercialRegistration` varchar(100),
	`taxNumber` varchar(100),
	`email` varchar(320),
	`phone` varchar(60),
	`country` varchar(120),
	`category` varchar(120),
	`supplierStatus` enum('active','suspended','blocked') NOT NULL DEFAULT 'active',
	`notes` text,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `suppliers_id` PRIMARY KEY(`id`),
	CONSTRAINT `suppliers_supplierNumber_unique` UNIQUE(`supplierNumber`)
);
--> statement-breakpoint
CREATE TABLE `userPermissions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`permissionId` int NOT NULL,
	`scopeType` varchar(40) NOT NULL DEFAULT 'global',
	`scopeValue` varchar(120),
	`grantedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `userPermissions_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_permission_scope_unique` UNIQUE(`userId`,`permissionId`,`scopeType`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`username` varchar(80),
	`passwordHash` varchar(255),
	`name` text,
	`email` varchar(320),
	`role` enum('user','admin') NOT NULL DEFAULT 'user',
	`active` boolean NOT NULL DEFAULT true,
	`preferredLocale` enum('ar','en','ur') NOT NULL DEFAULT 'ar',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`lastSignedIn` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_username_unique` UNIQUE(`username`)
);
--> statement-breakpoint
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
CREATE TABLE `p1_certificate_installments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`contract_id` int NOT NULL,
	`certificate_id` int NOT NULL,
	`version` int NOT NULL,
	`position` int NOT NULL,
	`name` varchar(150) NOT NULL,
	`percent` decimal(7,4) NOT NULL,
	`amount` decimal(18,2) NOT NULL,
	`due_date` varchar(10) NOT NULL,
	CONSTRAINT `p1_certificate_installments_id` PRIMARY KEY(`id`),
	CONSTRAINT `p1_cert_installment_version_position` UNIQUE(`certificate_id`,`version`,`position`)
);
--> statement-breakpoint
CREATE TABLE `p1_payment_reversals` (
	`id` int AUTO_INCREMENT NOT NULL,
	`payment_id` int NOT NULL,
	`pending_payment_id` int,
	`status` varchar(20) NOT NULL DEFAULT 'pending',
	`reason` text NOT NULL,
	`created_by` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`decided_by` int,
	`decided_at` timestamp,
	`decision_reason` text,
	CONSTRAINT `p1_payment_reversals_id` PRIMARY KEY(`id`),
	CONSTRAINT `p1_payment_reversals_pending_payment_id_unique` UNIQUE(`pending_payment_id`)
);
--> statement-breakpoint
CREATE TABLE `p1_certificates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`number` varchar(50) NOT NULL,
	`contract_id` int NOT NULL,
	`certificate_date` varchar(10) NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'pending',
	`quantities` json NOT NULL,
	`inspection_allocations` json,
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
	`release_date` varchar(10),
	`schedule_version` int NOT NULL DEFAULT 0,
	`schedule_reason` text,
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
	`warranty_days` int NOT NULL DEFAULT 0,
	`handover_date` varchar(10),
	`handover_by` int,
	`handover_reason` text,
	`scope` text NOT NULL,
	`terms` text NOT NULL,
	`revision` int NOT NULL DEFAULT 0,
	`status` varchar(20) NOT NULL DEFAULT 'active',
	`inspection_required` boolean NOT NULL DEFAULT false,
	`inspection_baseline` json,
	`correction_reason` text,
	`corrected_by` int,
	`corrected_at` timestamp,
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
	`installment_id` int,
	`replaces_payment_id` int,
	`status` varchar(20) NOT NULL DEFAULT 'active',
	`reversed_by` int,
	`reversed_at` timestamp,
	`reversal_reason` text,
	`kind` varchar(20) NOT NULL,
	`amount` decimal(18,2) NOT NULL,
	`payment_date` varchar(10) NOT NULL,
	`voucher` varchar(100) NOT NULL,
	`voucher_key` varchar(110),
	`notes` text NOT NULL,
	`created_by` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `p1_payments_id` PRIMARY KEY(`id`),
	CONSTRAINT `p1_payments_replaces_payment_id_unique` UNIQUE(`replaces_payment_id`),
	CONSTRAINT `p1_payments_voucher_key_unique` UNIQUE(`voucher_key`)
);
--> statement-breakpoint
CREATE TABLE `p1_projects` (
	`id` int AUTO_INCREMENT NOT NULL,
	`number` varchar(50) NOT NULL,
	`name` varchar(255) NOT NULL,
	`site` varchar(255) NOT NULL,
	`created_by` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `p1_projects_id` PRIMARY KEY(`id`),
	CONSTRAINT `p1_projects_number_unique` UNIQUE(`number`)
);
--> statement-breakpoint
CREATE TABLE `p1_work_inspections` (
	`id` int AUTO_INCREMENT NOT NULL,
	`number` varchar(50) NOT NULL,
	`contract_id` int NOT NULL,
	`item_index` int NOT NULL,
	`inspection_date` varchar(10) NOT NULL,
	`location` varchar(500) NOT NULL,
	`description` text NOT NULL,
	`executed` decimal(14,4) NOT NULL,
	`accepted` decimal(14,4) NOT NULL,
	`status` varchar(24) NOT NULL,
	`notes` text NOT NULL,
	`additional_signatures` json NOT NULL,
	`supplier_name` varchar(500) NOT NULL,
	`representative` varchar(500) NOT NULL,
	`previous_inspection_id` int,
	`revision` int NOT NULL DEFAULT 0,
	`created_by` int NOT NULL,
	`updated_by` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `p1_work_inspections_id` PRIMARY KEY(`id`),
	CONSTRAINT `p1_work_inspections_number_unique` UNIQUE(`number`)
);
--> statement-breakpoint
CREATE TABLE `access_denials` (
	`id` int AUTO_INCREMENT NOT NULL,
	`actor_id` int NOT NULL,
	`path` varchar(160) NOT NULL,
	`reason` varchar(60) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `access_denials_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `access_profiles` (
	`user_id` int NOT NULL,
	`template` varchar(30) NOT NULL DEFAULT 'custom',
	`all_projects` boolean NOT NULL DEFAULT false,
	`version` int NOT NULL DEFAULT 1,
	CONSTRAINT `access_profiles_user_id` PRIMARY KEY(`user_id`)
);
--> statement-breakpoint
CREATE TABLE `access_projects` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`project_id` int NOT NULL,
	CONSTRAINT `access_projects_id` PRIMARY KEY(`id`),
	CONSTRAINT `access_user_project_unique` UNIQUE(`user_id`,`project_id`)
);
--> statement-breakpoint
ALTER TABLE `operation_keys` ADD CONSTRAINT `operation_keys_actor_id_users_id_fk` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_audit_events` ADD CONSTRAINT `scm_audit_events_actor_id_users_id_fk` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `p1_certificate_installments` ADD CONSTRAINT `p1_certificate_installments_contract_id_p1_contracts_id_fk` FOREIGN KEY (`contract_id`) REFERENCES `p1_contracts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `p1_certificate_installments` ADD CONSTRAINT `p1_installment_certificate_fk` FOREIGN KEY (`certificate_id`) REFERENCES `p1_certificates`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `p1_payment_reversals` ADD CONSTRAINT `p1_payment_reversals_payment_id_p1_payments_id_fk` FOREIGN KEY (`payment_id`) REFERENCES `p1_payments`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `p1_payment_reversals` ADD CONSTRAINT `p1_payment_reversals_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `p1_payment_reversals` ADD CONSTRAINT `p1_payment_reversals_decided_by_users_id_fk` FOREIGN KEY (`decided_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `p1_certificates` ADD CONSTRAINT `p1_certificates_contract_id_p1_contracts_id_fk` FOREIGN KEY (`contract_id`) REFERENCES `p1_contracts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `p1_certificates` ADD CONSTRAINT `p1_certificates_decided_by_users_id_fk` FOREIGN KEY (`decided_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `p1_certificates` ADD CONSTRAINT `p1_certificates_released_by_users_id_fk` FOREIGN KEY (`released_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `p1_certificates` ADD CONSTRAINT `p1_certificates_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `p1_contracts` ADD CONSTRAINT `p1_contracts_project_id_p1_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `p1_projects`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `p1_contracts` ADD CONSTRAINT `p1_contracts_supplier_id_suppliers_id_fk` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `p1_contracts` ADD CONSTRAINT `p1_contracts_handover_by_users_id_fk` FOREIGN KEY (`handover_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `p1_contracts` ADD CONSTRAINT `p1_contracts_corrected_by_users_id_fk` FOREIGN KEY (`corrected_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `p1_contracts` ADD CONSTRAINT `p1_contracts_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `p1_milestones` ADD CONSTRAINT `p1_milestones_contract_id_p1_contracts_id_fk` FOREIGN KEY (`contract_id`) REFERENCES `p1_contracts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `p1_payments` ADD CONSTRAINT `p1_payments_contract_id_p1_contracts_id_fk` FOREIGN KEY (`contract_id`) REFERENCES `p1_contracts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `p1_payments` ADD CONSTRAINT `p1_payments_certificate_id_p1_certificates_id_fk` FOREIGN KEY (`certificate_id`) REFERENCES `p1_certificates`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `p1_payments` ADD CONSTRAINT `p1_payments_milestone_id_p1_milestones_id_fk` FOREIGN KEY (`milestone_id`) REFERENCES `p1_milestones`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `p1_payments` ADD CONSTRAINT `p1_payments_installment_id_p1_certificate_installments_id_fk` FOREIGN KEY (`installment_id`) REFERENCES `p1_certificate_installments`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `p1_payments` ADD CONSTRAINT `p1_payments_replaces_payment_id_p1_payments_id_fk` FOREIGN KEY (`replaces_payment_id`) REFERENCES `p1_payments`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `p1_payments` ADD CONSTRAINT `p1_payments_reversed_by_users_id_fk` FOREIGN KEY (`reversed_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `p1_payments` ADD CONSTRAINT `p1_payments_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `p1_projects` ADD CONSTRAINT `p1_projects_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `p1_work_inspections` ADD CONSTRAINT `p1_work_inspections_contract_id_p1_contracts_id_fk` FOREIGN KEY (`contract_id`) REFERENCES `p1_contracts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `p1_work_inspections` ADD CONSTRAINT `p1_work_inspections_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `p1_work_inspections` ADD CONSTRAINT `p1_work_inspections_updated_by_users_id_fk` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `p1_work_inspections` ADD CONSTRAINT `p1_fir_previous_fk` FOREIGN KEY (`previous_inspection_id`) REFERENCES `p1_work_inspections`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `access_denials` ADD CONSTRAINT `access_denials_actor_id_users_id_fk` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `access_profiles` ADD CONSTRAINT `access_profiles_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `access_projects` ADD CONSTRAINT `access_projects_user_id_access_profiles_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `access_profiles`(`user_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `access_projects` ADD CONSTRAINT `access_projects_project_id_p1_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `p1_projects`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `documents_entity_idx` ON `documents` (`entityType`,`entityId`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`userId`);--> statement-breakpoint
CREATE INDEX `scm_audit_entity` ON `scm_audit_events` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `scm_audit_actor_time` ON `scm_audit_events` (`actor_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `p1_certificate_contract_idx` ON `p1_certificates` (`contract_id`);--> statement-breakpoint
CREATE INDEX `p1_contract_supplier_idx` ON `p1_contracts` (`supplier_id`);--> statement-breakpoint
CREATE INDEX `p1_payment_contract_idx` ON `p1_payments` (`contract_id`);--> statement-breakpoint
CREATE INDEX `p1_inspection_contract_idx` ON `p1_work_inspections` (`contract_id`);--> statement-breakpoint
CREATE INDEX `access_denial_actor_time` ON `access_denials` (`actor_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `access_project_idx` ON `access_projects` (`project_id`);