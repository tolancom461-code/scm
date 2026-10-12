ALTER TABLE `p1_contracts` ADD `revision` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `p1_contracts` ADD `status` varchar(20) DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `p1_contracts` ADD `correction_reason` text;--> statement-breakpoint
ALTER TABLE `p1_contracts` ADD `corrected_by` int;--> statement-breakpoint
ALTER TABLE `p1_contracts` ADD `corrected_at` timestamp;--> statement-breakpoint
ALTER TABLE `p1_contracts` ADD CONSTRAINT `p1_contracts_corrected_by_users_id_fk` FOREIGN KEY (`corrected_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;