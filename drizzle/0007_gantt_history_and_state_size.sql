ALTER TABLE `pm_gantt_baseline_tasks` DROP FOREIGN KEY `pm_gantt_baseline_tasks_task_id_pm_tasks_id_fk`;
--> statement-breakpoint
ALTER TABLE `pm_gantt_studio_states` MODIFY COLUMN `state_json` mediumtext NOT NULL;
