ALTER TABLE `pm_projects`
  ADD COLUMN `cmms_site_id` int,
  ADD COLUMN `cmms_site_name` varchar(255),
  ADD COLUMN `cmms_section_id` int,
  ADD COLUMN `cmms_section_name` varchar(255),
  ADD COLUMN `cmms_asset_id` int,
  ADD COLUMN `cmms_asset_name` varchar(255);
--> statement-breakpoint
ALTER TABLE `pm_material_requisition_items`
  ADD COLUMN `cmms_category_id` int,
  ADD COLUMN `cmms_category_name` varchar(255),
  ADD COLUMN `cmms_review_role` varchar(80),
  ADD COLUMN `cmms_review_role_name` varchar(255);
--> statement-breakpoint
ALTER TABLE `pm_material_requisitions`
  ADD COLUMN `cmms_dispatch_next_at` timestamp NULL DEFAULT NULL,
  ADD COLUMN `cmms_dispatch_lease_id` varchar(36),
  ADD COLUMN `cmms_dispatch_source_id` varchar(64),
  ADD COLUMN `cmms_dispatch_attempts` int NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE INDEX `pm_material_req_cmms_due_idx`
  ON `pm_material_requisitions` (`cmms_dispatch_next_at`);
