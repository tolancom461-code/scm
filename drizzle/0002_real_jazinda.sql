CREATE TABLE `pm_gantt_baseline_tasks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`baseline_id` int NOT NULL,
	`task_id` int NOT NULL,
	`task_name` varchar(255) NOT NULL,
	`start_date` varchar(10) NOT NULL,
	`end_date` varchar(10) NOT NULL,
	`duration_days` int NOT NULL,
	CONSTRAINT `pm_gantt_baseline_tasks_id` PRIMARY KEY(`id`),
	CONSTRAINT `pm_gantt_baseline_task_unique` UNIQUE(`baseline_id`,`task_id`)
);
--> statement-breakpoint
CREATE TABLE `pm_gantt_baselines` (
	`id` int AUTO_INCREMENT NOT NULL,
	`project_id` int NOT NULL,
	`name` varchar(160) NOT NULL,
	`created_by` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `pm_gantt_baselines_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `pm_gantt_project_settings` (
	`project_id` int NOT NULL,
	`working_days` varchar(40) NOT NULL DEFAULT '[0,1,2,3,4]',
	`hours_per_day` int NOT NULL DEFAULT 8,
	`holidays` text NOT NULL,
	`mode` varchar(20) NOT NULL DEFAULT 'smart',
	`status_date` varchar(10),
	`deadline` varchar(10),
	`version` int NOT NULL DEFAULT 0,
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `pm_gantt_project_settings_project_id` PRIMARY KEY(`project_id`)
);
--> statement-breakpoint
CREATE TABLE `pm_gantt_task_links` (
	`id` int AUTO_INCREMENT NOT NULL,
	`project_id` int NOT NULL,
	`from_task_id` int NOT NULL,
	`to_task_id` int NOT NULL,
	`type` varchar(2) NOT NULL DEFAULT 'FS',
	`lag_days` int NOT NULL DEFAULT 0,
	`version` int NOT NULL DEFAULT 0,
	`created_by` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `pm_gantt_task_links_id` PRIMARY KEY(`id`),
	CONSTRAINT `pm_gantt_link_unique` UNIQUE(`project_id`,`from_task_id`,`to_task_id`,`type`)
);
--> statement-breakpoint
CREATE TABLE `pm_gantt_task_settings` (
	`task_id` int NOT NULL,
	`not_before` varchar(10),
	`is_milestone` boolean NOT NULL DEFAULT false,
	`version` int NOT NULL DEFAULT 0,
	CONSTRAINT `pm_gantt_task_settings_task_id` PRIMARY KEY(`task_id`)
);
--> statement-breakpoint
ALTER TABLE `pm_gantt_baseline_tasks` ADD CONSTRAINT `pm_gantt_baseline_tasks_baseline_id_pm_gantt_baselines_id_fk` FOREIGN KEY (`baseline_id`) REFERENCES `pm_gantt_baselines`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `pm_gantt_baseline_tasks` ADD CONSTRAINT `pm_gantt_baseline_tasks_task_id_pm_tasks_id_fk` FOREIGN KEY (`task_id`) REFERENCES `pm_tasks`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `pm_gantt_baselines` ADD CONSTRAINT `pm_gantt_baselines_project_id_pm_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `pm_projects`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `pm_gantt_baselines` ADD CONSTRAINT `pm_gantt_baselines_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `pm_gantt_project_settings` ADD CONSTRAINT `pm_gantt_project_settings_project_id_pm_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `pm_projects`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `pm_gantt_task_links` ADD CONSTRAINT `pm_gantt_task_links_project_id_pm_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `pm_projects`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `pm_gantt_task_links` ADD CONSTRAINT `pm_gantt_task_links_from_task_id_pm_tasks_id_fk` FOREIGN KEY (`from_task_id`) REFERENCES `pm_tasks`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `pm_gantt_task_links` ADD CONSTRAINT `pm_gantt_task_links_to_task_id_pm_tasks_id_fk` FOREIGN KEY (`to_task_id`) REFERENCES `pm_tasks`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `pm_gantt_task_links` ADD CONSTRAINT `pm_gantt_task_links_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `pm_gantt_task_settings` ADD CONSTRAINT `pm_gantt_task_settings_task_id_pm_tasks_id_fk` FOREIGN KEY (`task_id`) REFERENCES `pm_tasks`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `pm_gantt_baseline_task_idx` ON `pm_gantt_baseline_tasks` (`baseline_id`);--> statement-breakpoint
CREATE INDEX `pm_gantt_baseline_project_idx` ON `pm_gantt_baselines` (`project_id`);--> statement-breakpoint
CREATE INDEX `pm_gantt_links_project_idx` ON `pm_gantt_task_links` (`project_id`);