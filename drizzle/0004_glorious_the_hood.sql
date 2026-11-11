CREATE TABLE `pm_gantt_shared_task_groups` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`sync_dates` boolean NOT NULL DEFAULT true,
	`sync_status` boolean NOT NULL DEFAULT true,
	`sync_assignees` boolean NOT NULL DEFAULT false,
	`version` int NOT NULL DEFAULT 0,
	`created_by` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `pm_gantt_shared_task_groups_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `pm_gantt_shared_task_members` (
	`id` int AUTO_INCREMENT NOT NULL,
	`group_id` int NOT NULL,
	`task_id` int NOT NULL,
	CONSTRAINT `pm_gantt_shared_task_members_id` PRIMARY KEY(`id`),
	CONSTRAINT `pm_gantt_shared_member_task_unique` UNIQUE(`task_id`),
	CONSTRAINT `pm_gantt_shared_member_unique` UNIQUE(`group_id`,`task_id`)
);
--> statement-breakpoint
ALTER TABLE `pm_projects` ADD `planned_start_date` varchar(10);--> statement-breakpoint
ALTER TABLE `pm_projects` ADD `planned_end_date` varchar(10);--> statement-breakpoint
ALTER TABLE `pm_projects` ADD `actual_start_date` varchar(10);--> statement-breakpoint
ALTER TABLE `pm_projects` ADD `forecast_end_date` varchar(10);--> statement-breakpoint
ALTER TABLE `pm_projects` ADD `actual_end_date` varchar(10);--> statement-breakpoint
ALTER TABLE `pm_projects` ADD `start_locked` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `pm_projects` ADD `end_locked` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `pm_projects` ADD `extension_days` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `pm_projects` ADD `extension_reason` text;--> statement-breakpoint
ALTER TABLE `pm_gantt_task_settings` ADD `planned_start_date` varchar(10);--> statement-breakpoint
ALTER TABLE `pm_gantt_task_settings` ADD `planned_end_date` varchar(10);--> statement-breakpoint
ALTER TABLE `pm_gantt_task_settings` ADD `actual_start_date` varchar(10);--> statement-breakpoint
ALTER TABLE `pm_gantt_task_settings` ADD `actual_end_date` varchar(10);--> statement-breakpoint
ALTER TABLE `pm_gantt_task_settings` ADD `start_locked` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `pm_gantt_task_settings` ADD `end_locked` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `pm_gantt_shared_task_groups` ADD CONSTRAINT `pm_gantt_shared_task_groups_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `pm_gantt_shared_task_members` ADD CONSTRAINT `pm_gantt_member_group_fk` FOREIGN KEY (`group_id`) REFERENCES `pm_gantt_shared_task_groups`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `pm_gantt_shared_task_members` ADD CONSTRAINT `pm_gantt_member_task_fk` FOREIGN KEY (`task_id`) REFERENCES `pm_tasks`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `pm_gantt_shared_member_group_idx` ON `pm_gantt_shared_task_members` (`group_id`);
