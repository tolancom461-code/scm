CREATE TABLE `pm_work_calendar` (
	`id` int NOT NULL,
	`weekly_days_off` json NOT NULL,
	`holidays` json NOT NULL,
	`version` int NOT NULL DEFAULT 0,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `pm_work_calendar_id` PRIMARY KEY(`id`)
);--> statement-breakpoint
INSERT INTO `pm_work_calendar` (`id`, `weekly_days_off`, `holidays`)
VALUES (1, '[5,6]', '[]');
