CREATE TABLE `scm_award_lines` (
	`id` int AUTO_INCREMENT NOT NULL,
	`award_id` int NOT NULL,
	`quotation_line_id` int NOT NULL,
	`quantity` decimal(18,6) NOT NULL,
	`total` decimal(18,2) NOT NULL,
	CONSTRAINT `scm_award_lines_id` PRIMARY KEY(`id`),
	CONSTRAINT `award_quotation_line` UNIQUE(`award_id`,`quotation_line_id`),
	CONSTRAINT `award_line_positive` CHECK(`scm_award_lines`.`quantity`>0)
);
--> statement-breakpoint
CREATE TABLE `scm_order_lines` (
	`id` int AUTO_INCREMENT NOT NULL,
	`order_id` int NOT NULL,
	`award_line_id` int NOT NULL,
	`item_id` int NOT NULL,
	`uom_id` int NOT NULL,
	`description` text NOT NULL,
	`quantity` decimal(18,6) NOT NULL,
	`unit_price` decimal(18,2) NOT NULL,
	`discount_percent` decimal(7,4) NOT NULL,
	`tax_percent` decimal(7,4) NOT NULL,
	`subtotal` decimal(18,2) NOT NULL,
	`tax_amount` decimal(18,2) NOT NULL,
	`total` decimal(18,2) NOT NULL,
	`project_id` int NOT NULL,
	`wbs_id` int NOT NULL,
	`cost_center_id` int NOT NULL,
	`budget_id` int NOT NULL,
	CONSTRAINT `scm_order_lines_id` PRIMARY KEY(`id`),
	CONSTRAINT `order_award_line` UNIQUE(`order_id`,`award_line_id`),
	CONSTRAINT `order_line_positive` CHECK(`scm_order_lines`.`quantity`>0)
);
--> statement-breakpoint
CREATE TABLE `scm_order_schedules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`order_line_id` int NOT NULL,
	`quantity` decimal(18,6) NOT NULL,
	`due_date` date NOT NULL,
	`warehouse_id` int NOT NULL,
	`site_id` int NOT NULL,
	CONSTRAINT `scm_order_schedules_id` PRIMARY KEY(`id`),
	CONSTRAINT `order_schedule_positive` CHECK(`scm_order_schedules`.`quantity`>0)
);
--> statement-breakpoint
CREATE TABLE `scm_orders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`number` varchar(50) NOT NULL,
	`supplier_id` int NOT NULL,
	`currency` varchar(3) NOT NULL,
	`department` varchar(100) NOT NULL,
	`payment_terms` text NOT NULL,
	`delivery_terms` text NOT NULL,
	`total` decimal(18,2) NOT NULL,
	`status` enum('draft','pending','approved','rejected','returned','cancelled','closed') NOT NULL DEFAULT 'draft',
	`workflow_id` int,
	`created_by` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `scm_orders_id` PRIMARY KEY(`id`),
	CONSTRAINT `scm_orders_number_unique` UNIQUE(`number`)
);
--> statement-breakpoint
CREATE TABLE `scm_quotation_evaluations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`quotation_id` int NOT NULL,
	`technical` int NOT NULL,
	`commercial` int NOT NULL,
	`delivery` int NOT NULL,
	`overall` decimal(7,2) NOT NULL,
	`eligible` enum('yes','no') NOT NULL,
	`reason` text NOT NULL,
	`evaluated_by` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `scm_quotation_evaluations_id` PRIMARY KEY(`id`),
	CONSTRAINT `quotation_evaluation` UNIQUE(`quotation_id`),
	CONSTRAINT `quotation_scores` CHECK(`scm_quotation_evaluations`.`technical` BETWEEN 0 AND 100 AND `scm_quotation_evaluations`.`commercial` BETWEEN 0 AND 100 AND `scm_quotation_evaluations`.`delivery` BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE `scm_quotation_lines` (
	`id` int AUTO_INCREMENT NOT NULL,
	`quotation_id` int NOT NULL,
	`rfq_line_id` int NOT NULL,
	`quantity` decimal(18,6) NOT NULL,
	`unit_price` decimal(18,2) NOT NULL,
	`discount_percent` decimal(7,4) NOT NULL DEFAULT '0',
	`tax_percent` decimal(7,4) NOT NULL DEFAULT '0',
	`subtotal` decimal(18,2) NOT NULL,
	`tax_amount` decimal(18,2) NOT NULL,
	`total` decimal(18,2) NOT NULL,
	`brand` varchar(100),
	`model` varchar(100),
	`delivery_days` int NOT NULL,
	`warranty` text,
	`notes` text,
	CONSTRAINT `scm_quotation_lines_id` PRIMARY KEY(`id`),
	CONSTRAINT `quotation_rfq_line` UNIQUE(`quotation_id`,`rfq_line_id`),
	CONSTRAINT `quotation_line_values` CHECK(`scm_quotation_lines`.`quantity`>0 AND `scm_quotation_lines`.`unit_price`>=0 AND `scm_quotation_lines`.`discount_percent` BETWEEN 0 AND 100 AND `scm_quotation_lines`.`tax_percent` BETWEEN 0 AND 100 AND `scm_quotation_lines`.`delivery_days`>=0)
);
--> statement-breakpoint
CREATE TABLE `scm_requisition_lines` (
	`id` int AUTO_INCREMENT NOT NULL,
	`requisition_id` int NOT NULL,
	`position` int NOT NULL,
	`item_id` int NOT NULL,
	`description` text NOT NULL,
	`specification` text,
	`quantity` decimal(18,6) NOT NULL,
	`uom_id` int NOT NULL,
	`unit_price` decimal(18,2) NOT NULL,
	`amount` decimal(18,2) NOT NULL,
	`required_date` date NOT NULL,
	`site_id` int NOT NULL,
	`warehouse_id` int NOT NULL,
	`project_id` int NOT NULL,
	`wbs_id` int NOT NULL,
	`cost_center_id` int NOT NULL,
	`budget_id` int NOT NULL,
	CONSTRAINT `scm_requisition_lines_id` PRIMARY KEY(`id`),
	CONSTRAINT `requisition_line_position` UNIQUE(`requisition_id`,`position`),
	CONSTRAINT `requisition_line_values` CHECK(`scm_requisition_lines`.`quantity`>0 AND `scm_requisition_lines`.`unit_price`>=0 AND `scm_requisition_lines`.`amount`>=0)
);
--> statement-breakpoint
CREATE TABLE `scm_requisitions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`number` varchar(50) NOT NULL,
	`title` varchar(255) NOT NULL,
	`department` varchar(100) NOT NULL,
	`branch_id` int NOT NULL,
	`currency` varchar(3) NOT NULL,
	`priority` enum('low','normal','high','urgent') NOT NULL DEFAULT 'normal',
	`reason` text NOT NULL,
	`required_date` date NOT NULL,
	`total` decimal(18,2) NOT NULL,
	`status` enum('draft','pending','approved','rejected','returned','cancelled','closed') NOT NULL DEFAULT 'draft',
	`version` int NOT NULL DEFAULT 1,
	`workflow_id` int,
	`created_by` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `scm_requisitions_id` PRIMARY KEY(`id`),
	CONSTRAINT `scm_requisitions_number_unique` UNIQUE(`number`)
);
--> statement-breakpoint
CREATE TABLE `scm_rfq_lines` (
	`id` int AUTO_INCREMENT NOT NULL,
	`rfq_id` int NOT NULL,
	`requisition_line_id` int NOT NULL,
	`quantity` decimal(18,6) NOT NULL,
	CONSTRAINT `scm_rfq_lines_id` PRIMARY KEY(`id`),
	CONSTRAINT `rfq_source_line` UNIQUE(`rfq_id`,`requisition_line_id`),
	CONSTRAINT `rfq_line_quantity` CHECK(`scm_rfq_lines`.`quantity`>0)
);
--> statement-breakpoint
CREATE TABLE `scm_rfq_suppliers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`rfq_id` int NOT NULL,
	`supplier_id` int NOT NULL,
	CONSTRAINT `scm_rfq_suppliers_id` PRIMARY KEY(`id`),
	CONSTRAINT `rfq_supplier_invitation` UNIQUE(`rfq_id`,`supplier_id`)
);
--> statement-breakpoint
CREATE TABLE `scm_awards` (
	`id` int AUTO_INCREMENT NOT NULL,
	`number` varchar(50) NOT NULL,
	`rfq_id` int NOT NULL,
	`currency` varchar(3) NOT NULL,
	`department` varchar(100) NOT NULL,
	`reason` text NOT NULL,
	`total` decimal(18,2) NOT NULL,
	`status` enum('draft','pending','approved','rejected','returned','cancelled') NOT NULL DEFAULT 'draft',
	`workflow_id` int,
	`created_by` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `scm_awards_id` PRIMARY KEY(`id`),
	CONSTRAINT `scm_awards_number_unique` UNIQUE(`number`)
);
--> statement-breakpoint
CREATE TABLE `scm_rfqs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`number` varchar(50) NOT NULL,
	`title` varchar(255) NOT NULL,
	`currency` varchar(3) NOT NULL,
	`opens_at` date NOT NULL,
	`closes_at` date NOT NULL,
	`terms` text NOT NULL,
	`status` enum('draft','open','closed','cancelled') NOT NULL DEFAULT 'draft',
	`created_by` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `scm_rfqs_id` PRIMARY KEY(`id`),
	CONSTRAINT `scm_rfqs_number_unique` UNIQUE(`number`),
	CONSTRAINT `rfq_date_range` CHECK(`scm_rfqs`.`closes_at`>=`scm_rfqs`.`opens_at`)
);
--> statement-breakpoint
CREATE TABLE `scm_quotations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`number` varchar(50) NOT NULL,
	`supplier_reference` varchar(100) NOT NULL,
	`rfq_id` int NOT NULL,
	`supplier_id` int NOT NULL,
	`valid_until` date NOT NULL,
	`currency` varchar(3) NOT NULL,
	`payment_terms` text NOT NULL,
	`delivery_terms` text NOT NULL,
	`total` decimal(18,2) NOT NULL,
	`status` enum('received','evaluated','disqualified') NOT NULL DEFAULT 'received',
	`created_by` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `scm_quotations_id` PRIMARY KEY(`id`),
	CONSTRAINT `scm_quotations_number_unique` UNIQUE(`number`),
	CONSTRAINT `quotation_supplier_reference` UNIQUE(`supplier_id`,`supplier_reference`)
);
--> statement-breakpoint
ALTER TABLE `scm_award_lines` ADD CONSTRAINT `scm_award_lines_award_id_scm_awards_id_fk` FOREIGN KEY (`award_id`) REFERENCES `scm_awards`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_award_lines` ADD CONSTRAINT `scm_award_lines_quotation_line_id_scm_quotation_lines_id_fk` FOREIGN KEY (`quotation_line_id`) REFERENCES `scm_quotation_lines`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_order_lines` ADD CONSTRAINT `scm_order_lines_order_id_scm_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `scm_orders`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_order_lines` ADD CONSTRAINT `scm_order_lines_award_line_id_scm_award_lines_id_fk` FOREIGN KEY (`award_line_id`) REFERENCES `scm_award_lines`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_order_lines` ADD CONSTRAINT `scm_order_lines_item_id_scm_items_id_fk` FOREIGN KEY (`item_id`) REFERENCES `scm_items`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_order_lines` ADD CONSTRAINT `scm_order_lines_uom_id_scm_units_id_fk` FOREIGN KEY (`uom_id`) REFERENCES `scm_units`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_order_lines` ADD CONSTRAINT `scm_order_lines_project_id_scm_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `scm_projects`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_order_lines` ADD CONSTRAINT `scm_order_lines_wbs_id_scm_wbs_nodes_id_fk` FOREIGN KEY (`wbs_id`) REFERENCES `scm_wbs_nodes`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_order_lines` ADD CONSTRAINT `scm_order_lines_cost_center_id_scm_cost_centers_id_fk` FOREIGN KEY (`cost_center_id`) REFERENCES `scm_cost_centers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_order_lines` ADD CONSTRAINT `scm_order_lines_budget_id_scm_budgets_id_fk` FOREIGN KEY (`budget_id`) REFERENCES `scm_budgets`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_order_schedules` ADD CONSTRAINT `scm_order_schedules_order_line_id_scm_order_lines_id_fk` FOREIGN KEY (`order_line_id`) REFERENCES `scm_order_lines`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_order_schedules` ADD CONSTRAINT `scm_order_schedules_warehouse_id_scm_warehouses_id_fk` FOREIGN KEY (`warehouse_id`) REFERENCES `scm_warehouses`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_order_schedules` ADD CONSTRAINT `scm_order_schedules_site_id_scm_sites_id_fk` FOREIGN KEY (`site_id`) REFERENCES `scm_sites`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_orders` ADD CONSTRAINT `scm_orders_supplier_id_suppliers_id_fk` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_orders` ADD CONSTRAINT `scm_orders_workflow_id_scm_workflow_instances_id_fk` FOREIGN KEY (`workflow_id`) REFERENCES `scm_workflow_instances`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_orders` ADD CONSTRAINT `scm_orders_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_quotation_evaluations` ADD CONSTRAINT `scm_quotation_evaluations_quotation_id_scm_quotations_id_fk` FOREIGN KEY (`quotation_id`) REFERENCES `scm_quotations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_quotation_evaluations` ADD CONSTRAINT `scm_quotation_evaluations_evaluated_by_users_id_fk` FOREIGN KEY (`evaluated_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_quotation_lines` ADD CONSTRAINT `scm_quotation_lines_quotation_id_scm_quotations_id_fk` FOREIGN KEY (`quotation_id`) REFERENCES `scm_quotations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_quotation_lines` ADD CONSTRAINT `scm_quotation_lines_rfq_line_id_scm_rfq_lines_id_fk` FOREIGN KEY (`rfq_line_id`) REFERENCES `scm_rfq_lines`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_requisition_lines` ADD CONSTRAINT `scm_requisition_lines_requisition_id_scm_requisitions_id_fk` FOREIGN KEY (`requisition_id`) REFERENCES `scm_requisitions`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_requisition_lines` ADD CONSTRAINT `scm_requisition_lines_item_id_scm_items_id_fk` FOREIGN KEY (`item_id`) REFERENCES `scm_items`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_requisition_lines` ADD CONSTRAINT `scm_requisition_lines_uom_id_scm_units_id_fk` FOREIGN KEY (`uom_id`) REFERENCES `scm_units`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_requisition_lines` ADD CONSTRAINT `scm_requisition_lines_site_id_scm_sites_id_fk` FOREIGN KEY (`site_id`) REFERENCES `scm_sites`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_requisition_lines` ADD CONSTRAINT `scm_requisition_lines_warehouse_id_scm_warehouses_id_fk` FOREIGN KEY (`warehouse_id`) REFERENCES `scm_warehouses`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_requisition_lines` ADD CONSTRAINT `scm_requisition_lines_project_id_scm_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `scm_projects`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_requisition_lines` ADD CONSTRAINT `scm_requisition_lines_wbs_id_scm_wbs_nodes_id_fk` FOREIGN KEY (`wbs_id`) REFERENCES `scm_wbs_nodes`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_requisition_lines` ADD CONSTRAINT `scm_requisition_lines_cost_center_id_scm_cost_centers_id_fk` FOREIGN KEY (`cost_center_id`) REFERENCES `scm_cost_centers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_requisition_lines` ADD CONSTRAINT `scm_requisition_lines_budget_id_scm_budgets_id_fk` FOREIGN KEY (`budget_id`) REFERENCES `scm_budgets`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_requisitions` ADD CONSTRAINT `scm_requisitions_branch_id_scm_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `scm_branches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_requisitions` ADD CONSTRAINT `scm_requisitions_workflow_id_scm_workflow_instances_id_fk` FOREIGN KEY (`workflow_id`) REFERENCES `scm_workflow_instances`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_requisitions` ADD CONSTRAINT `scm_requisitions_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_rfq_lines` ADD CONSTRAINT `scm_rfq_lines_rfq_id_scm_rfqs_id_fk` FOREIGN KEY (`rfq_id`) REFERENCES `scm_rfqs`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_rfq_lines` ADD CONSTRAINT `scm_rfq_lines_requisition_line_id_scm_requisition_lines_id_fk` FOREIGN KEY (`requisition_line_id`) REFERENCES `scm_requisition_lines`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_rfq_suppliers` ADD CONSTRAINT `scm_rfq_suppliers_rfq_id_scm_rfqs_id_fk` FOREIGN KEY (`rfq_id`) REFERENCES `scm_rfqs`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_rfq_suppliers` ADD CONSTRAINT `scm_rfq_suppliers_supplier_id_suppliers_id_fk` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_awards` ADD CONSTRAINT `scm_awards_rfq_id_scm_rfqs_id_fk` FOREIGN KEY (`rfq_id`) REFERENCES `scm_rfqs`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_awards` ADD CONSTRAINT `scm_awards_workflow_id_scm_workflow_instances_id_fk` FOREIGN KEY (`workflow_id`) REFERENCES `scm_workflow_instances`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_awards` ADD CONSTRAINT `scm_awards_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_rfqs` ADD CONSTRAINT `scm_rfqs_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_quotations` ADD CONSTRAINT `scm_quotations_rfq_id_scm_rfqs_id_fk` FOREIGN KEY (`rfq_id`) REFERENCES `scm_rfqs`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_quotations` ADD CONSTRAINT `scm_quotations_supplier_id_suppliers_id_fk` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_quotations` ADD CONSTRAINT `scm_quotations_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `order_schedule_line_date` ON `scm_order_schedules` (`order_line_id`,`due_date`);--> statement-breakpoint
CREATE INDEX `order_supplier_status` ON `scm_orders` (`supplier_id`,`status`);--> statement-breakpoint
CREATE INDEX `requisition_status_date` ON `scm_requisitions` (`status`,`required_date`);--> statement-breakpoint
CREATE INDEX `quotation_rfq` ON `scm_quotations` (`rfq_id`);