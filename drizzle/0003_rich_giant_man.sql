CREATE TABLE `pm_gantt_studio_states` (
	`project_id` int NOT NULL,
	`state_json` text NOT NULL,
	`version` int NOT NULL DEFAULT 0,
	`updated_by` int NOT NULL,
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `pm_gantt_studio_states_project_id` PRIMARY KEY(`project_id`)
);
--> statement-breakpoint
ALTER TABLE `pm_gantt_studio_states` ADD CONSTRAINT `pm_gantt_studio_states_project_id_pm_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `pm_projects`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `pm_gantt_studio_states` ADD CONSTRAINT `pm_gantt_studio_states_updated_by_users_id_fk` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;