CREATE TABLE `access_denials` (
	`id` int AUTO_INCREMENT NOT NULL,
	`actor_id` int NOT NULL,
	`path` varchar(160) NOT NULL,
	`reason` varchar(60) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `access_denials_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `access_profiles` (
	`user_id` int NOT NULL,
	`template` varchar(30) NOT NULL DEFAULT 'custom',
	`all_projects` boolean NOT NULL DEFAULT false,
	`legacy_access` boolean NOT NULL DEFAULT false,
	`version` int NOT NULL DEFAULT 1,
	CONSTRAINT `access_profiles_user_id` PRIMARY KEY(`user_id`)
);
--> statement-breakpoint
CREATE TABLE `access_projects` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`project_id` int NOT NULL,
	CONSTRAINT `access_projects_id` PRIMARY KEY(`id`),
	CONSTRAINT `access_user_project_unique` UNIQUE(`user_id`,`project_id`)
);
--> statement-breakpoint
ALTER TABLE `access_denials` ADD CONSTRAINT `access_denials_actor_id_users_id_fk` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `access_profiles` ADD CONSTRAINT `access_profiles_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `access_projects` ADD CONSTRAINT `access_projects_user_id_access_profiles_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `access_profiles`(`user_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `access_projects` ADD CONSTRAINT `access_projects_project_id_p1_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `p1_projects`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `access_denial_actor_time` ON `access_denials` (`actor_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `access_project_idx` ON `access_projects` (`project_id`);
--> statement-breakpoint
INSERT INTO permissions (code,module,action,labelAr,labelEn,labelUr) VALUES
('policy.view','policy','view','عرض مركز السياسات','View policy center','پالیسی مرکز دیکھیں'),
('policy.manage','policy','manage','إدارة الأدوار والصلاحيات ونطاق المشاريع','Manage roles, permissions and project scope','کردار، اجازتیں اور منصوبوں کا دائرہ منظم کریں'),
('p1.projects.view','phaseOne','projects_view','عرض مشاريع المرحلة الأولى','View current projects','موجودہ منصوبے دیکھیں'),
('p1.projects.create','phaseOne','projects_create','إضافة مشروع','Create project','منصوبہ بنائیں'),
('p1.company.view','phaseOne','company_view','عرض تهيئة الشركة','View company setup','کمپنی کی ترتیبات دیکھیں'),
('p1.company.manage','phaseOne','company_manage','تعديل تهيئة الشركة','Edit company setup','کمپنی کی ترتیبات تبدیل کریں'),
('p1.contracts.view','phaseOne','contracts_view','عرض العقود وقيمها وجدول دفعاتها','View contracts, values and schedules','معاہدے، رقم اور شیڈول دیکھیں'),
('p1.contracts.create','phaseOne','contracts_create','إنشاء عقد مرحلة أولى','Create current contract','موجودہ معاہدہ بنائیں'),
('p1.certificates.view','phaseOne','certificates_view','عرض المستخلصات وقيمها','View certificates and values','مستخلص اور رقم دیکھیں'),
('p1.certificates.create','phaseOne','certificates_create','إعداد مستخلص مرحلة أولى','Prepare current certificate','موجودہ مستخلص تیار کریں'),
('p1.certificates.approve','phaseOne','certificates_approve','اعتماد أو رفض المستخلص','Approve or reject certificate','مستخلص منظور یا مسترد کریں'),
('p1.payments.view','phaseOne','payments_view','عرض المصروف والأرصدة والدفعة القادمة','View disbursements, balances and next installment','ادائیگی، بقایا اور اگلی قسط دیکھیں'),
('p1.payments.record','phaseOne','payments_record','تسجيل الصرف الفعلي','Record actual disbursement','اصل ادائیگی درج کریں'),
('p1.retention.release','phaseOne','retention_release','الإفراج عن ضمان الأعمال','Release retention','روکی گئی ضمانت جاری کریں'),
('p1.print','phaseOne','print','طباعة العقود والمستخلصات','Print contracts and certificates','معاہدے اور مستخلص پرنٹ کریں')
ON DUPLICATE KEY UPDATE labelAr=VALUES(labelAr), labelEn=VALUES(labelEn), labelUr=VALUES(labelUr);
--> statement-breakpoint
INSERT INTO access_profiles (user_id,template,all_projects,legacy_access) SELECT id,'custom',1,1 FROM users;
--> statement-breakpoint
INSERT INTO userPermissions (userId,permissionId,scopeType)
SELECT DISTINCT grants.userId,target.id,'global' FROM userPermissions grants
INNER JOIN permissions old ON old.id=grants.permissionId
INNER JOIN permissions target ON CASE WHEN old.code='contracts.view' AND target.code='p1.projects.view' THEN 1 WHEN old.code='contracts.view' AND target.code='p1.contracts.view' THEN 1 WHEN old.code='contracts.view' AND target.code='p1.certificates.view' THEN 1 WHEN old.code='contracts.view' AND target.code='p1.print' THEN 1 WHEN old.code='contracts.create' AND target.code='p1.contracts.create' THEN 1 WHEN old.code='certificates.create' AND target.code='p1.certificates.create' THEN 1 WHEN old.code='certificates.approve' AND target.code='p1.certificates.approve' THEN 1 WHEN old.code='finance.view' AND target.code='p1.projects.view' THEN 1 WHEN old.code='finance.view' AND target.code='p1.contracts.view' THEN 1 WHEN old.code='finance.view' AND target.code='p1.certificates.view' THEN 1 WHEN old.code='finance.view' AND target.code='p1.payments.view' THEN 1 WHEN old.code='financial.create' AND target.code='p1.payments.record' THEN 1 WHEN old.code='finance.approve' AND target.code='p1.retention.release' THEN 1 WHEN old.code='master.view' AND target.code='p1.company.view' THEN 1 WHEN old.code='master.view' AND target.code='p1.projects.view' THEN 1 WHEN old.code='master.manage' AND target.code='p1.company.manage' THEN 1 WHEN old.code='projects.manage' AND target.code='p1.projects.create' THEN 1 WHEN old.code='permissions.manage' AND target.code='policy.view' THEN 1 WHEN old.code='permissions.manage' AND target.code='policy.manage' THEN 1 ELSE 0 END = 1
WHERE grants.scopeType='global'
ON DUPLICATE KEY UPDATE scopeType='global';
