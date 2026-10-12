CREATE TABLE `auditLogs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int,
	`action` varchar(100) NOT NULL,
	`entityType` varchar(60) NOT NULL,
	`entityId` int,
	`oldValue` text,
	`newValue` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `auditLogs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `awards` (
	`id` int AUTO_INCREMENT NOT NULL,
	`awardNumber` varchar(50) NOT NULL,
	`quotationId` int NOT NULL,
	`supplierId` int NOT NULL,
	`amount` decimal(14,2) NOT NULL,
	`reason` text NOT NULL,
	`awardStatus` varchar(40) NOT NULL DEFAULT 'pending',
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `awards_id` PRIMARY KEY(`id`),
	CONSTRAINT `awards_awardNumber_unique` UNIQUE(`awardNumber`)
);
--> statement-breakpoint
CREATE TABLE `certificates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`certificateNumber` varchar(50) NOT NULL,
	`contractId` int NOT NULL,
	`currentValue` decimal(14,2) NOT NULL DEFAULT '0',
	`previousValue` decimal(14,2) NOT NULL DEFAULT '0',
	`deductions` decimal(14,2) NOT NULL DEFAULT '0',
	`netDue` decimal(14,2) NOT NULL DEFAULT '0',
	`certificateStatus` varchar(40) NOT NULL DEFAULT 'draft',
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `certificates_id` PRIMARY KEY(`id`),
	CONSTRAINT `certificates_certificateNumber_unique` UNIQUE(`certificateNumber`)
);
--> statement-breakpoint
CREATE TABLE `contractAmendments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`contractId` int NOT NULL,
	`amendmentNumber` varchar(50) NOT NULL,
	`amendmentType` varchar(50) NOT NULL,
	`valueChange` decimal(14,2) NOT NULL DEFAULT '0',
	`extensionDays` int NOT NULL DEFAULT 0,
	`reason` text NOT NULL,
	`amendmentStatus` varchar(40) NOT NULL DEFAULT 'draft',
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `contractAmendments_id` PRIMARY KEY(`id`),
	CONSTRAINT `contractAmendments_amendmentNumber_unique` UNIQUE(`amendmentNumber`)
);
--> statement-breakpoint
CREATE TABLE `contracts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`contractNumber` varchar(50) NOT NULL,
	`title` varchar(255) NOT NULL,
	`supplierId` int NOT NULL,
	`contractType` varchar(50) NOT NULL DEFAULT 'supply',
	`startDate` datetime,
	`endDate` datetime,
	`originalValue` decimal(14,2) NOT NULL,
	`currentValue` decimal(14,2) NOT NULL,
	`currency` varchar(8) NOT NULL DEFAULT 'SAR',
	`contractStatus` varchar(40) NOT NULL DEFAULT 'draft',
	`scope` text,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `contracts_id` PRIMARY KEY(`id`),
	CONSTRAINT `contracts_contractNumber_unique` UNIQUE(`contractNumber`)
);
--> statement-breakpoint
CREATE TABLE `deliveries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`deliveryNumber` varchar(50) NOT NULL,
	`poId` int NOT NULL,
	`supplierId` int NOT NULL,
	`deliveredAt` datetime NOT NULL,
	`deliveredValue` decimal(14,2) NOT NULL DEFAULT '0',
	`acceptedValue` decimal(14,2) NOT NULL DEFAULT '0',
	`rejectedValue` decimal(14,2) NOT NULL DEFAULT '0',
	`deliveryStatus` varchar(40) NOT NULL DEFAULT 'delivered',
	`reference` varchar(120),
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `deliveries_id` PRIMARY KEY(`id`),
	CONSTRAINT `deliveries_deliveryNumber_unique` UNIQUE(`deliveryNumber`)
);
--> statement-breakpoint
CREATE TABLE `documents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`documentNumber` varchar(50) NOT NULL,
	`entityType` varchar(60) NOT NULL,
	`entityId` int NOT NULL,
	`title` varchar(255) NOT NULL,
	`fileName` varchar(255) NOT NULL,
	`storageKey` varchar(500) NOT NULL,
	`url` varchar(700) NOT NULL,
	`mimeType` varchar(120) NOT NULL,
	`sizeBytes` int NOT NULL,
	`checksum` varchar(128) NOT NULL,
	`documentClassification` enum('normal','internal','confidential','highly_confidential') NOT NULL DEFAULT 'internal',
	`version` int NOT NULL DEFAULT 1,
	`uploadedBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `documents_id` PRIMARY KEY(`id`),
	CONSTRAINT `documents_documentNumber_unique` UNIQUE(`documentNumber`)
);
--> statement-breakpoint
CREATE TABLE `financialOperations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`operationNumber` varchar(50) NOT NULL,
	`supplierId` int NOT NULL,
	`contractId` int,
	`certificateId` int,
	`operationType` varchar(50) NOT NULL,
	`amount` decimal(14,2) NOT NULL,
	`currency` varchar(8) NOT NULL DEFAULT 'SAR',
	`operationDate` datetime NOT NULL,
	`financialOperationStatus` varchar(40) NOT NULL DEFAULT 'recorded',
	`notes` text,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `financialOperations_id` PRIMARY KEY(`id`),
	CONSTRAINT `financialOperations_operationNumber_unique` UNIQUE(`operationNumber`)
);
--> statement-breakpoint
CREATE TABLE `integrationEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sourceSystem` varchar(80) NOT NULL,
	`destinationSystem` varchar(80) NOT NULL,
	`eventType` varchar(100) NOT NULL,
	`entityType` varchar(60) NOT NULL,
	`entityId` int,
	`correlationId` varchar(100) NOT NULL,
	`integrationStatus` varchar(40) NOT NULL DEFAULT 'pending',
	`attempts` int NOT NULL DEFAULT 0,
	`lastError` text,
	`nextRetryAt` datetime,
	`completedAt` datetime,
	`payloadMeta` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `integrationEvents_id` PRIMARY KEY(`id`),
	CONSTRAINT `integrationEvents_correlationId_unique` UNIQUE(`correlationId`)
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`notificationType` varchar(80) NOT NULL,
	`titleAr` varchar(255) NOT NULL,
	`titleEn` varchar(255) NOT NULL,
	`titleUr` varchar(255) NOT NULL,
	`messageAr` text,
	`messageEn` text,
	`messageUr` text,
	`entityType` varchar(60),
	`entityId` int,
	`readAt` datetime,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `permissions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(120) NOT NULL,
	`module` varchar(60) NOT NULL,
	`action` varchar(60) NOT NULL,
	`labelAr` varchar(255) NOT NULL,
	`labelEn` varchar(255) NOT NULL,
	`labelUr` varchar(255) NOT NULL,
	CONSTRAINT `permissions_id` PRIMARY KEY(`id`),
	CONSTRAINT `permissions_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `purchaseOrders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`poNumber` varchar(50) NOT NULL,
	`supplierId` int NOT NULL,
	`contractId` int,
	`requestId` int,
	`totalAmount` decimal(14,2) NOT NULL DEFAULT '0',
	`currency` varchar(8) NOT NULL DEFAULT 'SAR',
	`deliveryDate` datetime,
	`deliveryLocation` varchar(255),
	`poStatus` varchar(40) NOT NULL DEFAULT 'draft',
	`terms` text,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `purchaseOrders_id` PRIMARY KEY(`id`),
	CONSTRAINT `purchaseOrders_poNumber_unique` UNIQUE(`poNumber`)
);
--> statement-breakpoint
CREATE TABLE `purchasePackages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`packageNumber` varchar(50) NOT NULL,
	`title` varchar(255) NOT NULL,
	`packageStatus` varchar(40) NOT NULL DEFAULT 'draft',
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `purchasePackages_id` PRIMARY KEY(`id`),
	CONSTRAINT `purchasePackages_packageNumber_unique` UNIQUE(`packageNumber`)
);
--> statement-breakpoint
CREATE TABLE `purchaseRequestItems` (
	`id` int AUTO_INCREMENT NOT NULL,
	`requestId` int NOT NULL,
	`description` varchar(500) NOT NULL,
	`quantity` decimal(14,3) NOT NULL,
	`unit` varchar(30) NOT NULL,
	`estimatedUnitPrice` decimal(14,2) NOT NULL DEFAULT '0',
	`specifications` text,
	CONSTRAINT `purchaseRequestItems_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `purchaseRequests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`requestNumber` varchar(50) NOT NULL,
	`title` varchar(255) NOT NULL,
	`department` varchar(120),
	`site` varchar(120),
	`source` varchar(80) NOT NULL DEFAULT 'internal',
	`requestPriority` enum('low','normal','high','urgent') NOT NULL DEFAULT 'normal',
	`estimatedValue` decimal(14,2) NOT NULL DEFAULT '0',
	`currency` varchar(8) NOT NULL DEFAULT 'SAR',
	`neededBy` datetime,
	`requestStatus` enum('draft','submitted','approved','rejected','cancelled') NOT NULL DEFAULT 'draft',
	`notes` text,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `purchaseRequests_id` PRIMARY KEY(`id`),
	CONSTRAINT `purchaseRequests_requestNumber_unique` UNIQUE(`requestNumber`)
);
--> statement-breakpoint
CREATE TABLE `quotations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`rfqId` int NOT NULL,
	`supplierId` int NOT NULL,
	`totalAmount` decimal(14,2) NOT NULL,
	`currency` varchar(8) NOT NULL DEFAULT 'SAR',
	`deliveryDays` int,
	`paymentTerms` varchar(255),
	`technicalCompliance` varchar(60),
	`quotationStatus` varchar(40) NOT NULL DEFAULT 'received',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `quotations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `requestApprovals` (
	`id` int AUTO_INCREMENT NOT NULL,
	`requestId` int NOT NULL,
	`approvalAction` enum('submitted','approved','rejected','cancelled','revised') NOT NULL,
	`comment` text,
	`actedBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `requestApprovals_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `rfqs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`rfqNumber` varchar(50) NOT NULL,
	`title` varchar(255) NOT NULL,
	`closingAt` datetime,
	`rfqStatus` varchar(40) NOT NULL DEFAULT 'draft',
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `rfqs_id` PRIMARY KEY(`id`),
	CONSTRAINT `rfqs_rfqNumber_unique` UNIQUE(`rfqNumber`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`tokenHash` varchar(128) NOT NULL,
	`expiresAt` datetime NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `sessions_tokenHash_unique` UNIQUE(`tokenHash`)
);
--> statement-breakpoint
CREATE TABLE `suppliers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`supplierNumber` varchar(40) NOT NULL,
	`nameAr` varchar(255) NOT NULL,
	`nameEn` varchar(255),
	`nameUr` varchar(255),
	`commercialRegistration` varchar(100),
	`taxNumber` varchar(100),
	`email` varchar(320),
	`phone` varchar(60),
	`country` varchar(120),
	`category` varchar(120),
	`supplierStatus` enum('active','suspended','blocked') NOT NULL DEFAULT 'active',
	`notes` text,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `suppliers_id` PRIMARY KEY(`id`),
	CONSTRAINT `suppliers_supplierNumber_unique` UNIQUE(`supplierNumber`)
);
--> statement-breakpoint
CREATE TABLE `userPermissions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`permissionId` int NOT NULL,
	`scopeType` varchar(40) NOT NULL DEFAULT 'global',
	`scopeValue` varchar(120),
	`grantedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `userPermissions_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_permission_scope_unique` UNIQUE(`userId`,`permissionId`,`scopeType`)
);
--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `loginMethod` varchar(64) DEFAULT 'local';--> statement-breakpoint
ALTER TABLE `users` ADD `username` varchar(80);--> statement-breakpoint
ALTER TABLE `users` ADD `passwordHash` varchar(255);--> statement-breakpoint
ALTER TABLE `users` ADD `active` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `preferredLocale` enum('ar','en','ur') DEFAULT 'ar' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_username_unique` UNIQUE(`username`);--> statement-breakpoint
CREATE INDEX `audit_entity_idx` ON `auditLogs` (`entityType`,`entityId`);--> statement-breakpoint
CREATE INDEX `documents_entity_idx` ON `documents` (`entityType`,`entityId`);--> statement-breakpoint
CREATE INDEX `notifications_user_idx` ON `notifications` (`userId`);--> statement-breakpoint
CREATE INDEX `request_items_request_idx` ON `purchaseRequestItems` (`requestId`);--> statement-breakpoint
CREATE INDEX `approvals_request_idx` ON `requestApprovals` (`requestId`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`userId`);