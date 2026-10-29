CREATE TABLE `pm_projects` (
	`id` int AUTO_INCREMENT NOT NULL,
	`number` varchar(50) NOT NULL,
	`name` varchar(255) NOT NULL,
	`site` varchar(500) NOT NULL DEFAULT '',
	`description` text NOT NULL,
	`requirements` text NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'draft',
	`version` int NOT NULL DEFAULT 0,
	`created_by` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	`started_at` timestamp,
	CONSTRAINT `pm_projects_id` PRIMARY KEY(`id`),
	CONSTRAINT `pm_projects_number_unique` UNIQUE(`number`)
);
--> statement-breakpoint
CREATE TABLE `pm_employees` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(200) NOT NULL,
	`job_title` varchar(200) NOT NULL DEFAULT '',
	`active` boolean NOT NULL DEFAULT true,
	`version` int NOT NULL DEFAULT 0,
	CONSTRAINT `pm_employees_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `pm_project_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`project_id` int NOT NULL,
	`action` varchar(30) NOT NULL,
	`comment` text NOT NULL,
	`actor_id` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `pm_project_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `pm_tasks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`project_id` int NOT NULL,
	`parent_id` int,
	`name` varchar(255) NOT NULL,
	`status_id` int NOT NULL,
	`start_date` varchar(10) NOT NULL,
	`end_date` varchar(10) NOT NULL,
	`priority` varchar(20) NOT NULL DEFAULT 'medium',
	`level` int NOT NULL,
	`version` int NOT NULL DEFAULT 0,
	`created_by` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `pm_tasks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `pm_task_assignees` (
	`id` int AUTO_INCREMENT NOT NULL,
	`task_id` int NOT NULL,
	`employee_id` int NOT NULL,
	CONSTRAINT `pm_task_assignees_id` PRIMARY KEY(`id`),
	CONSTRAINT `pm_task_employee_unique` UNIQUE(`task_id`,`employee_id`)
);
--> statement-breakpoint
CREATE TABLE `pm_task_statuses` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(60) NOT NULL,
	`name` varchar(100) NOT NULL,
	`version` int NOT NULL DEFAULT 0,
	CONSTRAINT `pm_task_statuses_id` PRIMARY KEY(`id`),
	CONSTRAINT `pm_task_statuses_code_unique` UNIQUE(`code`),
	CONSTRAINT `pm_task_statuses_name_unique` UNIQUE(`name`)
);
--> statement-breakpoint
CREATE TABLE `access_construction_projects` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`project_id` int NOT NULL,
	CONSTRAINT `access_construction_projects_id` PRIMARY KEY(`id`),
	CONSTRAINT `access_pm_user_project_unique` UNIQUE(`user_id`,`project_id`)
);
--> statement-breakpoint
ALTER TABLE `pm_projects` ADD CONSTRAINT `pm_projects_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `pm_project_events` ADD CONSTRAINT `pm_project_events_project_id_pm_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `pm_projects`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `pm_project_events` ADD CONSTRAINT `pm_project_events_actor_id_users_id_fk` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `pm_tasks` ADD CONSTRAINT `pm_tasks_project_id_pm_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `pm_projects`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `pm_tasks` ADD CONSTRAINT `pm_tasks_parent_id_pm_tasks_id_fk` FOREIGN KEY (`parent_id`) REFERENCES `pm_tasks`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `pm_tasks` ADD CONSTRAINT `pm_tasks_status_id_pm_task_statuses_id_fk` FOREIGN KEY (`status_id`) REFERENCES `pm_task_statuses`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `pm_tasks` ADD CONSTRAINT `pm_tasks_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `pm_task_assignees` ADD CONSTRAINT `pm_task_assignees_task_id_pm_tasks_id_fk` FOREIGN KEY (`task_id`) REFERENCES `pm_tasks`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `pm_task_assignees` ADD CONSTRAINT `pm_task_assignees_employee_id_pm_employees_id_fk` FOREIGN KEY (`employee_id`) REFERENCES `pm_employees`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `access_construction_projects` ADD CONSTRAINT `access_construction_projects_user_id_access_profiles_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `access_profiles`(`user_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `access_construction_projects` ADD CONSTRAINT `access_construction_projects_project_id_pm_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `pm_projects`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `pm_projects_status_idx` ON `pm_projects` (`status`);--> statement-breakpoint
CREATE INDEX `pm_event_project_idx` ON `pm_project_events` (`project_id`);--> statement-breakpoint
CREATE INDEX `pm_tasks_project_idx` ON `pm_tasks` (`project_id`);--> statement-breakpoint
CREATE INDEX `access_pm_project_idx` ON `access_construction_projects` (`project_id`);