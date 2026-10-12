CREATE TABLE `scm_workflow_approvers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`step_id` int NOT NULL,
	`user_id` int NOT NULL,
	`approval_limit` decimal(18,2) NOT NULL,
	CONSTRAINT `scm_workflow_approvers_id` PRIMARY KEY(`id`),
	CONSTRAINT `workflow_step_user` UNIQUE(`step_id`,`user_id`),
	CONSTRAINT `workflow_limit_nonnegative` CHECK(`scm_workflow_approvers`.`approval_limit` >= 0)
);
--> statement-breakpoint
CREATE TABLE `scm_workflow_decisions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`instance_id` int NOT NULL,
	`step_id` int NOT NULL,
	`actor_id` int NOT NULL,
	`on_behalf_of` int NOT NULL,
	`delegation_id` int,
	`action` enum('approve','reject','return') NOT NULL,
	`reason` text NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `scm_workflow_decisions_id` PRIMARY KEY(`id`),
	CONSTRAINT `workflow_decision_once` UNIQUE(`instance_id`,`step_id`)
);
--> statement-breakpoint
CREATE TABLE `scm_workflow_definitions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(40) NOT NULL,
	`version` int NOT NULL,
	`name_ar` varchar(255) NOT NULL,
	`name_en` varchar(255) NOT NULL,
	`name_ur` varchar(255) NOT NULL,
	`entity_type` varchar(40) NOT NULL,
	`currency` varchar(3) NOT NULL,
	`department` varchar(100) NOT NULL DEFAULT '*',
	`min_amount` decimal(18,2) NOT NULL,
	`max_amount` decimal(18,2),
	`active` enum('yes','no') NOT NULL DEFAULT 'yes',
	`created_by` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `scm_workflow_definitions_id` PRIMARY KEY(`id`),
	CONSTRAINT `workflow_code_version` UNIQUE(`code`,`version`),
	CONSTRAINT `workflow_amount_range` CHECK(`scm_workflow_definitions`.`min_amount` >= 0 AND (`scm_workflow_definitions`.`max_amount` IS NULL OR `scm_workflow_definitions`.`max_amount` > `scm_workflow_definitions`.`min_amount`))
);
--> statement-breakpoint
CREATE TABLE `scm_workflow_delegations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`from_user_id` int NOT NULL,
	`to_user_id` int NOT NULL,
	`entity_type` varchar(40) NOT NULL,
	`starts_at` datetime NOT NULL,
	`ends_at` datetime NOT NULL,
	`revoked_at` datetime,
	`reason` text NOT NULL,
	`created_by` int NOT NULL,
	CONSTRAINT `scm_workflow_delegations_id` PRIMARY KEY(`id`),
	CONSTRAINT `delegation_valid` CHECK(`scm_workflow_delegations`.`from_user_id` <> `scm_workflow_delegations`.`to_user_id` AND `scm_workflow_delegations`.`ends_at` > `scm_workflow_delegations`.`starts_at`)
);
--> statement-breakpoint
CREATE TABLE `scm_workflow_instances` (
	`id` int AUTO_INCREMENT NOT NULL,
	`definition_id` int NOT NULL,
	`entity_type` varchar(40) NOT NULL,
	`entity_id` int NOT NULL,
	`cycle` int NOT NULL,
	`amount` decimal(18,2) NOT NULL,
	`currency` varchar(3) NOT NULL,
	`department` varchar(100) NOT NULL,
	`requester_id` int NOT NULL,
	`blocked_actor_ids` json NOT NULL,
	`current_position` int NOT NULL DEFAULT 1,
	`status` enum('pending','approved','rejected','returned','cancelled') NOT NULL DEFAULT 'pending',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `scm_workflow_instances_id` PRIMARY KEY(`id`),
	CONSTRAINT `workflow_entity_cycle` UNIQUE(`entity_type`,`entity_id`,`cycle`)
);
--> statement-breakpoint
CREATE TABLE `scm_workflow_steps` (
	`id` int AUTO_INCREMENT NOT NULL,
	`definition_id` int NOT NULL,
	`position` int NOT NULL,
	`name_ar` varchar(255) NOT NULL,
	`name_en` varchar(255) NOT NULL,
	`name_ur` varchar(255) NOT NULL,
	CONSTRAINT `scm_workflow_steps_id` PRIMARY KEY(`id`),
	CONSTRAINT `workflow_step_position` UNIQUE(`definition_id`,`position`),
	CONSTRAINT `workflow_step_positive` CHECK(`scm_workflow_steps`.`position` > 0)
);
--> statement-breakpoint
CREATE TABLE `scm_budget_ledger` (
	`id` int AUTO_INCREMENT NOT NULL,
	`budget_id` int NOT NULL,
	`metric` enum('commitment','received','actual','paid') NOT NULL,
	`amount` decimal(18,2) NOT NULL,
	`source_type` varchar(40) NOT NULL,
	`source_id` int NOT NULL,
	`source_line_id` int NOT NULL,
	`event_key` varchar(100) NOT NULL,
	`actor_id` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `scm_budget_ledger_id` PRIMARY KEY(`id`),
	CONSTRAINT `scm_budget_ledger_event_key_unique` UNIQUE(`event_key`)
);
--> statement-breakpoint
CREATE TABLE `scm_budgets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`project_id` int NOT NULL,
	`wbs_id` int NOT NULL,
	`cost_center_id` int NOT NULL,
	`amount` decimal(18,2) NOT NULL,
	`status` enum('draft','approved','rejected','superseded') NOT NULL DEFAULT 'draft',
	`replaces_id` int,
	`created_by` int NOT NULL,
	`approved_by` int,
	`reason` text NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `scm_budgets_id` PRIMARY KEY(`id`),
	CONSTRAINT `budget_nonnegative` CHECK(`scm_budgets`.`amount` >= 0)
);
--> statement-breakpoint
CREATE TABLE `scm_projects` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(40) NOT NULL,
	`name_ar` varchar(255) NOT NULL,
	`name_en` varchar(255) NOT NULL,
	`name_ur` varchar(255) NOT NULL,
	`branch_id` int NOT NULL,
	`manager_id` int NOT NULL,
	`currency` varchar(3) NOT NULL DEFAULT 'SAR',
	`starts_at` date,
	`ends_at` date,
	`status` enum('planning','active','on_hold','completed','cancelled') NOT NULL DEFAULT 'planning',
	`version` int NOT NULL DEFAULT 1,
	`created_by` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `scm_projects_id` PRIMARY KEY(`id`),
	CONSTRAINT `scm_projects_code_unique` UNIQUE(`code`),
	CONSTRAINT `project_dates` CHECK(`scm_projects`.`ends_at` IS NULL OR `scm_projects`.`starts_at` IS NULL OR `scm_projects`.`ends_at` >= `scm_projects`.`starts_at`)
);
--> statement-breakpoint
CREATE TABLE `scm_wbs_nodes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`project_id` int NOT NULL,
	`parent_id` int,
	`code` varchar(40) NOT NULL,
	`name_ar` varchar(255) NOT NULL,
	`name_en` varchar(255) NOT NULL,
	`name_ur` varchar(255) NOT NULL,
	`starts_at` date,
	`ends_at` date,
	`progress` int NOT NULL DEFAULT 0,
	`created_by` int NOT NULL,
	CONSTRAINT `scm_wbs_nodes_id` PRIMARY KEY(`id`),
	CONSTRAINT `wbs_project_code` UNIQUE(`project_id`,`code`),
	CONSTRAINT `wbs_progress` CHECK(`scm_wbs_nodes`.`progress` BETWEEN 0 AND 100),
	CONSTRAINT `wbs_dates` CHECK(`scm_wbs_nodes`.`ends_at` IS NULL OR `scm_wbs_nodes`.`starts_at` IS NULL OR `scm_wbs_nodes`.`ends_at` >= `scm_wbs_nodes`.`starts_at`)
);
--> statement-breakpoint
ALTER TABLE `scm_workflow_approvers` ADD CONSTRAINT `scm_workflow_approvers_step_id_scm_workflow_steps_id_fk` FOREIGN KEY (`step_id`) REFERENCES `scm_workflow_steps`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_workflow_approvers` ADD CONSTRAINT `scm_workflow_approvers_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_workflow_decisions` ADD CONSTRAINT `scm_workflow_decisions_instance_id_scm_workflow_instances_id_fk` FOREIGN KEY (`instance_id`) REFERENCES `scm_workflow_instances`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_workflow_decisions` ADD CONSTRAINT `scm_workflow_decisions_step_id_scm_workflow_steps_id_fk` FOREIGN KEY (`step_id`) REFERENCES `scm_workflow_steps`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_workflow_decisions` ADD CONSTRAINT `scm_workflow_decisions_actor_id_users_id_fk` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_workflow_decisions` ADD CONSTRAINT `scm_workflow_decisions_on_behalf_of_users_id_fk` FOREIGN KEY (`on_behalf_of`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_workflow_decisions` ADD CONSTRAINT `workflow_decision_delegation_fk` FOREIGN KEY (`delegation_id`) REFERENCES `scm_workflow_delegations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_workflow_definitions` ADD CONSTRAINT `scm_workflow_definitions_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_workflow_delegations` ADD CONSTRAINT `scm_workflow_delegations_from_user_id_users_id_fk` FOREIGN KEY (`from_user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_workflow_delegations` ADD CONSTRAINT `scm_workflow_delegations_to_user_id_users_id_fk` FOREIGN KEY (`to_user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_workflow_delegations` ADD CONSTRAINT `scm_workflow_delegations_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_workflow_instances` ADD CONSTRAINT `workflow_instance_definition_fk` FOREIGN KEY (`definition_id`) REFERENCES `scm_workflow_definitions`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_workflow_instances` ADD CONSTRAINT `scm_workflow_instances_requester_id_users_id_fk` FOREIGN KEY (`requester_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_workflow_steps` ADD CONSTRAINT `scm_workflow_steps_definition_id_scm_workflow_definitions_id_fk` FOREIGN KEY (`definition_id`) REFERENCES `scm_workflow_definitions`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_budget_ledger` ADD CONSTRAINT `scm_budget_ledger_budget_id_scm_budgets_id_fk` FOREIGN KEY (`budget_id`) REFERENCES `scm_budgets`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_budget_ledger` ADD CONSTRAINT `scm_budget_ledger_actor_id_users_id_fk` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_budgets` ADD CONSTRAINT `scm_budgets_project_id_scm_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `scm_projects`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_budgets` ADD CONSTRAINT `scm_budgets_wbs_id_scm_wbs_nodes_id_fk` FOREIGN KEY (`wbs_id`) REFERENCES `scm_wbs_nodes`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_budgets` ADD CONSTRAINT `scm_budgets_cost_center_id_scm_cost_centers_id_fk` FOREIGN KEY (`cost_center_id`) REFERENCES `scm_cost_centers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_budgets` ADD CONSTRAINT `scm_budgets_replaces_id_scm_budgets_id_fk` FOREIGN KEY (`replaces_id`) REFERENCES `scm_budgets`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_budgets` ADD CONSTRAINT `scm_budgets_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_budgets` ADD CONSTRAINT `scm_budgets_approved_by_users_id_fk` FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_projects` ADD CONSTRAINT `scm_projects_branch_id_scm_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `scm_branches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_projects` ADD CONSTRAINT `scm_projects_manager_id_users_id_fk` FOREIGN KEY (`manager_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_projects` ADD CONSTRAINT `scm_projects_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_wbs_nodes` ADD CONSTRAINT `scm_wbs_nodes_project_id_scm_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `scm_projects`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_wbs_nodes` ADD CONSTRAINT `scm_wbs_nodes_parent_id_scm_wbs_nodes_id_fk` FOREIGN KEY (`parent_id`) REFERENCES `scm_wbs_nodes`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_wbs_nodes` ADD CONSTRAINT `scm_wbs_nodes_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `workflow_selection` ON `scm_workflow_definitions` (`entity_type`,`currency`,`department`,`active`);--> statement-breakpoint
CREATE INDEX `delegation_eligibility` ON `scm_workflow_delegations` (`from_user_id`,`to_user_id`,`entity_type`);--> statement-breakpoint
CREATE INDEX `workflow_pending` ON `scm_workflow_instances` (`status`,`definition_id`);--> statement-breakpoint
CREATE INDEX `budget_ledger_scope` ON `scm_budget_ledger` (`budget_id`,`metric`);--> statement-breakpoint
CREATE INDEX `budget_scope_status` ON `scm_budgets` (`project_id`,`wbs_id`,`cost_center_id`,`status`);--> statement-breakpoint
CREATE INDEX `project_branch_status` ON `scm_projects` (`branch_id`,`status`);