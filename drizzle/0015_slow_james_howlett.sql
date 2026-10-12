CREATE TABLE `p1_certificate_installments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`contract_id` int NOT NULL,
	`certificate_id` int NOT NULL,
	`version` int NOT NULL,
	`position` int NOT NULL,
	`name` varchar(150) NOT NULL,
	`percent` decimal(7,4) NOT NULL,
	`amount` decimal(18,2) NOT NULL,
	`due_date` varchar(10) NOT NULL,
	CONSTRAINT `p1_certificate_installments_id` PRIMARY KEY(`id`),
	CONSTRAINT `p1_cert_installment_version_position` UNIQUE(`certificate_id`,`version`,`position`)
);
--> statement-breakpoint
CREATE TABLE `p1_payment_reversals` (
	`id` int AUTO_INCREMENT NOT NULL,
	`payment_id` int NOT NULL,
	`pending_payment_id` int,
	`status` varchar(20) NOT NULL DEFAULT 'pending',
	`reason` text NOT NULL,
	`created_by` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`decided_by` int,
	`decided_at` timestamp,
	`decision_reason` text,
	CONSTRAINT `p1_payment_reversals_id` PRIMARY KEY(`id`),
	CONSTRAINT `p1_payment_reversals_pending_payment_id_unique` UNIQUE(`pending_payment_id`)
);
--> statement-breakpoint
ALTER TABLE `p1_payments` MODIFY COLUMN `voucher_key` varchar(110);--> statement-breakpoint
ALTER TABLE `p1_certificates` ADD `schedule_version` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `p1_certificates` ADD `schedule_reason` text;--> statement-breakpoint
ALTER TABLE `p1_contracts` ADD `handover_date` varchar(10);--> statement-breakpoint
ALTER TABLE `p1_contracts` ADD `handover_by` int;--> statement-breakpoint
ALTER TABLE `p1_contracts` ADD `handover_reason` text;--> statement-breakpoint
ALTER TABLE `p1_payments` ADD `installment_id` int;--> statement-breakpoint
ALTER TABLE `p1_payments` ADD `replaces_payment_id` int;--> statement-breakpoint
ALTER TABLE `p1_payments` ADD `status` varchar(20) DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `p1_payments` ADD `reversed_by` int;--> statement-breakpoint
ALTER TABLE `p1_payments` ADD `reversed_at` timestamp;--> statement-breakpoint
ALTER TABLE `p1_payments` ADD `reversal_reason` text;--> statement-breakpoint
ALTER TABLE `p1_payments` ADD CONSTRAINT `p1_payments_replaces_payment_id_unique` UNIQUE(`replaces_payment_id`);--> statement-breakpoint
ALTER TABLE `p1_certificate_installments` ADD CONSTRAINT `p1_certificate_installments_contract_id_p1_contracts_id_fk` FOREIGN KEY (`contract_id`) REFERENCES `p1_contracts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `p1_certificate_installments` ADD CONSTRAINT `p1_installment_certificate_fk` FOREIGN KEY (`certificate_id`) REFERENCES `p1_certificates`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `p1_payment_reversals` ADD CONSTRAINT `p1_payment_reversals_payment_id_p1_payments_id_fk` FOREIGN KEY (`payment_id`) REFERENCES `p1_payments`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `p1_payment_reversals` ADD CONSTRAINT `p1_payment_reversals_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `p1_payment_reversals` ADD CONSTRAINT `p1_payment_reversals_decided_by_users_id_fk` FOREIGN KEY (`decided_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `p1_contracts` ADD CONSTRAINT `p1_contracts_handover_by_users_id_fk` FOREIGN KEY (`handover_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `p1_payments` ADD CONSTRAINT `p1_payments_installment_id_p1_certificate_installments_id_fk` FOREIGN KEY (`installment_id`) REFERENCES `p1_certificate_installments`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `p1_payments` ADD CONSTRAINT `p1_payments_replaces_payment_id_p1_payments_id_fk` FOREIGN KEY (`replaces_payment_id`) REFERENCES `p1_payments`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `p1_payments` ADD CONSTRAINT `p1_payments_reversed_by_users_id_fk` FOREIGN KEY (`reversed_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
INSERT INTO permissions (code,module,action,labelAr,labelEn,labelUr) VALUES ('p1.certificates.schedule','phaseOne','certificates_schedule','اعتماد جدول دفعات المستخلص وتعديل توزيع السندات','Approve certificate installment schedules and voucher allocation','مستخلص کی اقساط کا شیڈول منظور کریں'),('p1.payments.reverse.approve','phaseOne','payments_reverse_approve','اعتماد أو رفض عكس سجل الصرف','Approve or reject disbursement record reversals','ادائیگی کی واپسی منظور یا مسترد کریں'),('p1.contracts.handover','phaseOne','contracts_handover','اعتماد التسليم النهائي وبداية الضمان','Approve final handover and warranty commencement','آخری حوالگی اور ضمانت کا آغاز منظور کریں') ON DUPLICATE KEY UPDATE labelAr=VALUES(labelAr),labelEn=VALUES(labelEn),labelUr=VALUES(labelUr);
--> statement-breakpoint
INSERT INTO scm_audit_events (actor_id,action,entity_type,entity_id,before_value,after_value,reason) SELECT owner.id,'policy.schema.upgraded','user_policy',ap.user_id,JSON_OBJECT('version',ap.version),JSON_OBJECT('version',ap.version+1,'addedPermissions',JSON_ARRAY('p1.certificates.schedule','p1.payments.reverse.approve','p1.contracts.handover')),'Financial controls migration 0015: extend existing approver templates only; scopes and custom overrides preserved' FROM access_profiles ap JOIN (SELECT MIN(id) id FROM users WHERE role='admin' AND active=1) owner WHERE ap.user_id IN (SELECT ap.user_id FROM access_profiles ap JOIN userPermissions up ON up.userId=ap.user_id AND up.scopeType='global' JOIN permissions old ON old.id=up.permissionId AND old.code='p1.certificates.approve' WHERE ap.template='approver');
--> statement-breakpoint
INSERT IGNORE INTO userPermissions (userId,permissionId,scopeType) SELECT eligible.user_id,p.id,'global' FROM (SELECT ap.user_id FROM access_profiles ap JOIN userPermissions up ON up.userId=ap.user_id AND up.scopeType='global' JOIN permissions old ON old.id=up.permissionId AND old.code='p1.certificates.approve' WHERE ap.template='approver') eligible JOIN permissions p ON p.code IN ('p1.certificates.schedule','p1.payments.reverse.approve','p1.contracts.handover');
--> statement-breakpoint
UPDATE access_profiles ap JOIN (SELECT DISTINCT up.userId FROM userPermissions up JOIN permissions p ON p.id=up.permissionId WHERE p.code='p1.certificates.approve' AND up.scopeType='global') eligible ON eligible.userId=ap.user_id SET ap.version=ap.version+1 WHERE ap.template='approver';
