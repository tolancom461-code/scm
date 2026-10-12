CREATE TABLE `scm_goods_receipts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`number` varchar(50) NOT NULL,
	`order_id` int NOT NULL,
	`shipment_id` int,
	`warehouse_id` int NOT NULL,
	`received_at` datetime NOT NULL,
	`status` enum('under_inspection','inspected') NOT NULL DEFAULT 'under_inspection',
	`received_by` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `scm_goods_receipts_id` PRIMARY KEY(`id`),
	CONSTRAINT `scm_goods_receipts_number_unique` UNIQUE(`number`)
);
--> statement-breakpoint
CREATE TABLE `scm_inspection_results` (
	`id` int AUTO_INCREMENT NOT NULL,
	`inspection_id` int NOT NULL,
	`allocation_id` int NOT NULL,
	`accepted` decimal(18,6) NOT NULL,
	`rejected` decimal(18,6) NOT NULL,
	`quarantine` decimal(18,6) NOT NULL,
	`defects` text,
	`storage_location_id` int NOT NULL,
	`rejected_location_id` int NOT NULL,
	`quarantine_location_id` int NOT NULL,
	CONSTRAINT `scm_inspection_results_id` PRIMARY KEY(`id`),
	CONSTRAINT `inspection_result_allocation` UNIQUE(`inspection_id`,`allocation_id`)
);
--> statement-breakpoint
CREATE TABLE `scm_inspections` (
	`id` int AUTO_INCREMENT NOT NULL,
	`number` varchar(50) NOT NULL,
	`receipt_id` int NOT NULL,
	`inspected_by` int NOT NULL,
	`notes` text NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `scm_inspections_id` PRIMARY KEY(`id`),
	CONSTRAINT `scm_inspections_number_unique` UNIQUE(`number`)
);
--> statement-breakpoint
CREATE TABLE `scm_receipt_allocations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`receipt_line_id` int NOT NULL,
	`batch_id` int NOT NULL,
	`quantity` decimal(18,6) NOT NULL,
	`accepted` decimal(18,6) NOT NULL DEFAULT '0',
	`rejected` decimal(18,6) NOT NULL DEFAULT '0',
	`quarantine` decimal(18,6) NOT NULL DEFAULT '0',
	`returned_accepted` decimal(18,6) NOT NULL DEFAULT '0',
	`returned_rejected` decimal(18,6) NOT NULL DEFAULT '0',
	`returned_quarantine` decimal(18,6) NOT NULL DEFAULT '0',
	`inspected_by` int,
	`inspected_at` datetime,
	CONSTRAINT `scm_receipt_allocations_id` PRIMARY KEY(`id`),
	CONSTRAINT `receipt_batch_allocation` UNIQUE(`receipt_line_id`,`batch_id`),
	CONSTRAINT `inspection_quantities` CHECK(`scm_receipt_allocations`.`quantity`>0 AND `scm_receipt_allocations`.`accepted`>=0 AND `scm_receipt_allocations`.`rejected`>=0 AND `scm_receipt_allocations`.`quarantine`>=0 AND `scm_receipt_allocations`.`accepted`+`scm_receipt_allocations`.`rejected`+`scm_receipt_allocations`.`quarantine`<=`scm_receipt_allocations`.`quantity`)
);
--> statement-breakpoint
CREATE TABLE `scm_receipt_lines` (
	`id` int AUTO_INCREMENT NOT NULL,
	`receipt_id` int NOT NULL,
	`order_line_id` int NOT NULL,
	`schedule_id` int NOT NULL,
	`quantity` decimal(18,6) NOT NULL,
	`base_quantity` decimal(18,6) NOT NULL,
	`uom_id` int NOT NULL,
	`base_uom_id` int NOT NULL,
	`factor` decimal(18,6) NOT NULL,
	`unit_cost` decimal(18,6) NOT NULL,
	`received_location_id` int NOT NULL,
	CONSTRAINT `scm_receipt_lines_id` PRIMARY KEY(`id`),
	CONSTRAINT `receipt_schedule_line` UNIQUE(`receipt_id`,`schedule_id`),
	CONSTRAINT `receipt_line_positive` CHECK(`scm_receipt_lines`.`quantity`>0 AND `scm_receipt_lines`.`base_quantity`>0 AND `scm_receipt_lines`.`factor`>0)
);
--> statement-breakpoint
CREATE TABLE `scm_shipment_lines` (
	`id` int AUTO_INCREMENT NOT NULL,
	`shipment_id` int NOT NULL,
	`order_line_id` int NOT NULL,
	`quantity` decimal(18,6) NOT NULL,
	CONSTRAINT `scm_shipment_lines_id` PRIMARY KEY(`id`),
	CONSTRAINT `shipment_order_line` UNIQUE(`shipment_id`,`order_line_id`),
	CONSTRAINT `shipment_quantity_positive` CHECK(`scm_shipment_lines`.`quantity`>0)
);
--> statement-breakpoint
CREATE TABLE `scm_shipments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`number` varchar(50) NOT NULL,
	`order_id` int NOT NULL,
	`supplier_id` int NOT NULL,
	`carrier` varchar(150) NOT NULL,
	`tracking_number` varchar(150),
	`ship_date` date NOT NULL,
	`expected_arrival` date NOT NULL,
	`actual_arrival` date,
	`freight` decimal(18,2) NOT NULL DEFAULT '0',
	`insurance` decimal(18,2) NOT NULL DEFAULT '0',
	`customs` decimal(18,2) NOT NULL DEFAULT '0',
	`status` enum('in_transit','arrived','cancelled') NOT NULL DEFAULT 'in_transit',
	`created_by` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `scm_shipments_id` PRIMARY KEY(`id`),
	CONSTRAINT `scm_shipments_number_unique` UNIQUE(`number`),
	CONSTRAINT `shipment_dates` CHECK(`scm_shipments`.`expected_arrival`>=`scm_shipments`.`ship_date`)
);
--> statement-breakpoint
CREATE TABLE `scm_stock_batches` (
	`id` int AUTO_INCREMENT NOT NULL,
	`item_id` int NOT NULL,
	`code` varchar(150) NOT NULL,
	`lot_code` varchar(100),
	`serial_code` varchar(100),
	`expires_at` date,
	CONSTRAINT `scm_stock_batches_id` PRIMARY KEY(`id`),
	CONSTRAINT `scm_stock_batches_serial_code_unique` UNIQUE(`serial_code`),
	CONSTRAINT `stock_batch_item_code` UNIQUE(`item_id`,`code`)
);
--> statement-breakpoint
CREATE TABLE `scm_return_lines` (
	`id` int AUTO_INCREMENT NOT NULL,
	`return_id` int NOT NULL,
	`allocation_id` int NOT NULL,
	`location_id` int NOT NULL,
	`quantity` decimal(18,6) NOT NULL,
	`source_status` enum('available','rejected','quarantine') NOT NULL,
	CONSTRAINT `scm_return_lines_id` PRIMARY KEY(`id`),
	CONSTRAINT `supplier_return_positive` CHECK(`scm_return_lines`.`quantity`>0)
);
--> statement-breakpoint
CREATE TABLE `scm_supplier_returns` (
	`id` int AUTO_INCREMENT NOT NULL,
	`number` varchar(50) NOT NULL,
	`receipt_id` int NOT NULL,
	`reason` text NOT NULL,
	`resolution` enum('replacement','credit') NOT NULL,
	`created_by` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `scm_supplier_returns_id` PRIMARY KEY(`id`),
	CONSTRAINT `scm_supplier_returns_number_unique` UNIQUE(`number`)
);
--> statement-breakpoint
CREATE TABLE `scm_stock_balances` (
	`id` int AUTO_INCREMENT NOT NULL,
	`item_id` int NOT NULL,
	`location_id` int NOT NULL,
	`batch_id` int NOT NULL,
	`status` enum('available','reserved','inspection','quarantine','rejected','damaged') NOT NULL,
	`currency` varchar(3) NOT NULL DEFAULT 'SAR',
	`quantity` decimal(18,6) NOT NULL DEFAULT '0',
	`value` decimal(18,6) NOT NULL DEFAULT '0',
	`version` int NOT NULL DEFAULT 1,
	CONSTRAINT `scm_stock_balances_id` PRIMARY KEY(`id`),
	CONSTRAINT `stock_balance_key` UNIQUE(`item_id`,`location_id`,`batch_id`,`status`),
	CONSTRAINT `stock_nonnegative` CHECK(`scm_stock_balances`.`quantity`>=0 AND `scm_stock_balances`.`value`>=0)
);
--> statement-breakpoint
CREATE TABLE `scm_stock_movements` (
	`id` int AUTO_INCREMENT NOT NULL,
	`item_id` int NOT NULL,
	`location_id` int NOT NULL,
	`batch_id` int NOT NULL,
	`status` enum('available','reserved','inspection','quarantine','rejected','damaged') NOT NULL,
	`currency` varchar(3) NOT NULL DEFAULT 'SAR',
	`quantity` decimal(18,6) NOT NULL,
	`value` decimal(18,6) NOT NULL,
	`type` varchar(40) NOT NULL,
	`source_type` varchar(40) NOT NULL,
	`source_id` int NOT NULL,
	`source_line_id` int NOT NULL,
	`event_key` varchar(120) NOT NULL,
	`actor_id` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `scm_stock_movements_id` PRIMARY KEY(`id`),
	CONSTRAINT `scm_stock_movements_event_key_unique` UNIQUE(`event_key`)
);
--> statement-breakpoint
CREATE TABLE `scm_stock_operation_lines` (
	`id` int AUTO_INCREMENT NOT NULL,
	`operation_id` int NOT NULL,
	`item_id` int NOT NULL,
	`batch_id` int NOT NULL,
	`from_location_id` int NOT NULL,
	`to_location_id` int,
	`quantity` decimal(18,6) NOT NULL,
	`counted_quantity` decimal(18,6),
	`balance_version` int,
	`reservation_line_id` int,
	`released_quantity` decimal(18,6) NOT NULL DEFAULT '0',
	`unit_cost` decimal(18,6),
	CONSTRAINT `scm_stock_operation_lines_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `scm_stock_operations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`number` varchar(50) NOT NULL,
	`type` enum('issue','transfer','reserve','release','adjustment','count') NOT NULL,
	`project_id` int,
	`wbs_id` int,
	`reason` text NOT NULL,
	`status` enum('draft','pending','approved','rejected','returned','posted') NOT NULL DEFAULT 'draft',
	`workflow_id` int,
	`currency` varchar(3) NOT NULL,
	`department` varchar(100) NOT NULL,
	`created_by` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `scm_stock_operations_id` PRIMARY KEY(`id`),
	CONSTRAINT `scm_stock_operations_number_unique` UNIQUE(`number`)
);
--> statement-breakpoint
ALTER TABLE `scm_goods_receipts` ADD CONSTRAINT `scm_goods_receipts_order_id_scm_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `scm_orders`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_goods_receipts` ADD CONSTRAINT `scm_goods_receipts_shipment_id_scm_shipments_id_fk` FOREIGN KEY (`shipment_id`) REFERENCES `scm_shipments`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_goods_receipts` ADD CONSTRAINT `scm_goods_receipts_warehouse_id_scm_warehouses_id_fk` FOREIGN KEY (`warehouse_id`) REFERENCES `scm_warehouses`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_goods_receipts` ADD CONSTRAINT `scm_goods_receipts_received_by_users_id_fk` FOREIGN KEY (`received_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_inspection_results` ADD CONSTRAINT `scm_inspection_results_inspection_id_scm_inspections_id_fk` FOREIGN KEY (`inspection_id`) REFERENCES `scm_inspections`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_inspection_results` ADD CONSTRAINT `inspection_allocation_fk` FOREIGN KEY (`allocation_id`) REFERENCES `scm_receipt_allocations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_inspection_results` ADD CONSTRAINT `inspection_storage_fk` FOREIGN KEY (`storage_location_id`) REFERENCES `scm_warehouse_locations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_inspection_results` ADD CONSTRAINT `inspection_rejected_fk` FOREIGN KEY (`rejected_location_id`) REFERENCES `scm_warehouse_locations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_inspection_results` ADD CONSTRAINT `inspection_quarantine_fk` FOREIGN KEY (`quarantine_location_id`) REFERENCES `scm_warehouse_locations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_inspections` ADD CONSTRAINT `scm_inspections_receipt_id_scm_goods_receipts_id_fk` FOREIGN KEY (`receipt_id`) REFERENCES `scm_goods_receipts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_inspections` ADD CONSTRAINT `scm_inspections_inspected_by_users_id_fk` FOREIGN KEY (`inspected_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_receipt_allocations` ADD CONSTRAINT `scm_receipt_allocations_receipt_line_id_scm_receipt_lines_id_fk` FOREIGN KEY (`receipt_line_id`) REFERENCES `scm_receipt_lines`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_receipt_allocations` ADD CONSTRAINT `scm_receipt_allocations_batch_id_scm_stock_batches_id_fk` FOREIGN KEY (`batch_id`) REFERENCES `scm_stock_batches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_receipt_allocations` ADD CONSTRAINT `scm_receipt_allocations_inspected_by_users_id_fk` FOREIGN KEY (`inspected_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_receipt_lines` ADD CONSTRAINT `scm_receipt_lines_receipt_id_scm_goods_receipts_id_fk` FOREIGN KEY (`receipt_id`) REFERENCES `scm_goods_receipts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_receipt_lines` ADD CONSTRAINT `scm_receipt_lines_order_line_id_scm_order_lines_id_fk` FOREIGN KEY (`order_line_id`) REFERENCES `scm_order_lines`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_receipt_lines` ADD CONSTRAINT `scm_receipt_lines_schedule_id_scm_order_schedules_id_fk` FOREIGN KEY (`schedule_id`) REFERENCES `scm_order_schedules`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_receipt_lines` ADD CONSTRAINT `scm_receipt_lines_uom_id_scm_units_id_fk` FOREIGN KEY (`uom_id`) REFERENCES `scm_units`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_receipt_lines` ADD CONSTRAINT `scm_receipt_lines_base_uom_id_scm_units_id_fk` FOREIGN KEY (`base_uom_id`) REFERENCES `scm_units`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_receipt_lines` ADD CONSTRAINT `receipt_location_fk` FOREIGN KEY (`received_location_id`) REFERENCES `scm_warehouse_locations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_shipment_lines` ADD CONSTRAINT `scm_shipment_lines_shipment_id_scm_shipments_id_fk` FOREIGN KEY (`shipment_id`) REFERENCES `scm_shipments`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_shipment_lines` ADD CONSTRAINT `scm_shipment_lines_order_line_id_scm_order_lines_id_fk` FOREIGN KEY (`order_line_id`) REFERENCES `scm_order_lines`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_shipments` ADD CONSTRAINT `scm_shipments_order_id_scm_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `scm_orders`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_shipments` ADD CONSTRAINT `scm_shipments_supplier_id_suppliers_id_fk` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_shipments` ADD CONSTRAINT `scm_shipments_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_stock_batches` ADD CONSTRAINT `scm_stock_batches_item_id_scm_items_id_fk` FOREIGN KEY (`item_id`) REFERENCES `scm_items`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_return_lines` ADD CONSTRAINT `scm_return_lines_return_id_scm_supplier_returns_id_fk` FOREIGN KEY (`return_id`) REFERENCES `scm_supplier_returns`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_return_lines` ADD CONSTRAINT `scm_return_lines_allocation_id_scm_receipt_allocations_id_fk` FOREIGN KEY (`allocation_id`) REFERENCES `scm_receipt_allocations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_return_lines` ADD CONSTRAINT `scm_return_lines_location_id_scm_warehouse_locations_id_fk` FOREIGN KEY (`location_id`) REFERENCES `scm_warehouse_locations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_supplier_returns` ADD CONSTRAINT `scm_supplier_returns_receipt_id_scm_goods_receipts_id_fk` FOREIGN KEY (`receipt_id`) REFERENCES `scm_goods_receipts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_supplier_returns` ADD CONSTRAINT `scm_supplier_returns_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_stock_balances` ADD CONSTRAINT `scm_stock_balances_item_id_scm_items_id_fk` FOREIGN KEY (`item_id`) REFERENCES `scm_items`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_stock_balances` ADD CONSTRAINT `scm_stock_balances_location_id_scm_warehouse_locations_id_fk` FOREIGN KEY (`location_id`) REFERENCES `scm_warehouse_locations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_stock_balances` ADD CONSTRAINT `scm_stock_balances_batch_id_scm_stock_batches_id_fk` FOREIGN KEY (`batch_id`) REFERENCES `scm_stock_batches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_stock_movements` ADD CONSTRAINT `scm_stock_movements_item_id_scm_items_id_fk` FOREIGN KEY (`item_id`) REFERENCES `scm_items`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_stock_movements` ADD CONSTRAINT `scm_stock_movements_location_id_scm_warehouse_locations_id_fk` FOREIGN KEY (`location_id`) REFERENCES `scm_warehouse_locations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_stock_movements` ADD CONSTRAINT `scm_stock_movements_batch_id_scm_stock_batches_id_fk` FOREIGN KEY (`batch_id`) REFERENCES `scm_stock_batches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_stock_movements` ADD CONSTRAINT `scm_stock_movements_actor_id_users_id_fk` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_stock_operation_lines` ADD CONSTRAINT `stock_op_line_operation_fk` FOREIGN KEY (`operation_id`) REFERENCES `scm_stock_operations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_stock_operation_lines` ADD CONSTRAINT `scm_stock_operation_lines_item_id_scm_items_id_fk` FOREIGN KEY (`item_id`) REFERENCES `scm_items`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_stock_operation_lines` ADD CONSTRAINT `scm_stock_operation_lines_batch_id_scm_stock_batches_id_fk` FOREIGN KEY (`batch_id`) REFERENCES `scm_stock_batches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_stock_operation_lines` ADD CONSTRAINT `stock_op_from_location_fk` FOREIGN KEY (`from_location_id`) REFERENCES `scm_warehouse_locations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_stock_operation_lines` ADD CONSTRAINT `stock_op_to_location_fk` FOREIGN KEY (`to_location_id`) REFERENCES `scm_warehouse_locations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_stock_operations` ADD CONSTRAINT `scm_stock_operations_project_id_scm_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `scm_projects`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_stock_operations` ADD CONSTRAINT `scm_stock_operations_wbs_id_scm_wbs_nodes_id_fk` FOREIGN KEY (`wbs_id`) REFERENCES `scm_wbs_nodes`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_stock_operations` ADD CONSTRAINT `scm_stock_operations_workflow_id_scm_workflow_instances_id_fk` FOREIGN KEY (`workflow_id`) REFERENCES `scm_workflow_instances`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scm_stock_operations` ADD CONSTRAINT `scm_stock_operations_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `stock_movement_item_time` ON `scm_stock_movements` (`item_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `stock_movement_source` ON `scm_stock_movements` (`source_type`,`source_id`);--> statement-breakpoint
CREATE INDEX `stock_operation_lines_operation` ON `scm_stock_operation_lines` (`operation_id`);