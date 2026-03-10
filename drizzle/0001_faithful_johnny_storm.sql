CREATE TABLE `antiban_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`dailyDmLimit` int NOT NULL DEFAULT 30,
	`minIntervalSeconds` int NOT NULL DEFAULT 60,
	`maxIntervalSeconds` int NOT NULL DEFAULT 180,
	`activeHourStart` int NOT NULL DEFAULT 9,
	`activeHourEnd` int NOT NULL DEFAULT 22,
	`deduplicateEnabled` boolean NOT NULL DEFAULT true,
	`deduplicateWindowHours` int NOT NULL DEFAULT 24,
	`warningThreshold` int NOT NULL DEFAULT 70,
	`degradedThreshold` int NOT NULL DEFAULT 40,
	`suspendThreshold` int NOT NULL DEFAULT 20,
	`autoDegrade` boolean NOT NULL DEFAULT true,
	`templateRotation` boolean NOT NULL DEFAULT true,
	`dmEnabled` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `antiban_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `antiban_settings_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `blacklist` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`targetTgId` varchar(64),
	`targetUsername` varchar(128),
	`reason` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `blacklist_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `dm_queue` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`hitRecordId` bigint,
	`senderAccountId` int NOT NULL,
	`targetTgId` varchar(64) NOT NULL,
	`targetUsername` varchar(128),
	`templateId` int,
	`content` text NOT NULL,
	`scheduledAt` timestamp NOT NULL,
	`status` enum('pending','processing','sent','failed','cancelled') NOT NULL DEFAULT 'pending',
	`retryCount` int NOT NULL DEFAULT 0,
	`maxRetries` int NOT NULL DEFAULT 3,
	`sentAt` timestamp,
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dm_queue_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `hit_records` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`monitorGroupId` int NOT NULL,
	`keywordId` int NOT NULL,
	`tgAccountId` int NOT NULL,
	`messageId` varchar(64),
	`messageContent` text,
	`messageDate` timestamp,
	`senderTgId` varchar(64),
	`senderUsername` varchar(128),
	`senderFirstName` varchar(128),
	`senderLastName` varchar(128),
	`matchedKeyword` varchar(512),
	`dmStatus` enum('pending','queued','sent','failed','skipped','duplicate') NOT NULL DEFAULT 'pending',
	`dmSentAt` timestamp,
	`dmTemplateId` int,
	`dmContent` text,
	`dmError` text,
	`isProcessed` boolean NOT NULL DEFAULT false,
	`processedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `hit_records_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `keyword_groups` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(128) NOT NULL,
	`description` text,
	`color` varchar(16) DEFAULT '#3B82F6',
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `keyword_groups_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `keywords` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`groupId` int,
	`keyword` varchar(512) NOT NULL,
	`matchType` enum('exact','contains','regex','and','or','not') NOT NULL DEFAULT 'contains',
	`subKeywords` json,
	`caseSensitive` boolean NOT NULL DEFAULT false,
	`hitCount` int NOT NULL DEFAULT 0,
	`lastHitAt` timestamp,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `keywords_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `message_templates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(128) NOT NULL,
	`content` text NOT NULL,
	`weight` int NOT NULL DEFAULT 1,
	`usedCount` int NOT NULL DEFAULT 0,
	`lastUsedAt` timestamp,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `message_templates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `monitor_groups` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`tgAccountId` int NOT NULL,
	`groupId` varchar(64) NOT NULL,
	`groupTitle` varchar(256),
	`groupUsername` varchar(128),
	`groupType` enum('group','supergroup','channel') DEFAULT 'supergroup',
	`memberCount` int,
	`keywordIds` json,
	`monitorStatus` enum('active','paused','error') NOT NULL DEFAULT 'active',
	`lastMessageAt` timestamp,
	`totalHits` int NOT NULL DEFAULT 0,
	`errorMessage` text,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `monitor_groups_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `plans` (
	`id` enum('free','basic','pro','enterprise') NOT NULL,
	`name` varchar(64) NOT NULL,
	`price` decimal(10,2) NOT NULL,
	`maxMonitorGroups` int NOT NULL,
	`maxKeywords` int NOT NULL,
	`maxDailyDm` int NOT NULL,
	`maxTgAccounts` int NOT NULL,
	`maxTemplates` int NOT NULL,
	`features` json,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `plans_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tg_accounts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`phone` varchar(32),
	`tgUserId` varchar(32),
	`tgUsername` varchar(128),
	`tgFirstName` varchar(128),
	`tgLastName` varchar(128),
	`sessionString` text,
	`sessionStatus` enum('pending','active','expired','banned') NOT NULL DEFAULT 'pending',
	`accountRole` enum('monitor','sender','both') NOT NULL DEFAULT 'both',
	`healthScore` int NOT NULL DEFAULT 100,
	`healthStatus` enum('healthy','warning','degraded','suspended') NOT NULL DEFAULT 'healthy',
	`totalMonitored` int NOT NULL DEFAULT 0,
	`totalDmSent` int NOT NULL DEFAULT 0,
	`dailyDmSent` int NOT NULL DEFAULT 0,
	`dailyDmResetAt` timestamp,
	`lastActiveAt` timestamp,
	`proxyHost` varchar(256),
	`proxyPort` int,
	`proxyType` enum('socks5','http','mtproto'),
	`proxyUsername` varchar(128),
	`proxyPassword` varchar(256),
	`notes` text,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `tg_accounts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `planId` enum('free','basic','pro','enterprise') DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `planExpiresAt` timestamp;--> statement-breakpoint
ALTER TABLE `users` ADD `dailyDmSent` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `dailyDmResetAt` timestamp;--> statement-breakpoint
CREATE INDEX `idx_antiban_settings_userId` ON `antiban_settings` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_blacklist_userId` ON `blacklist` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_blacklist_targetTgId` ON `blacklist` (`targetTgId`);--> statement-breakpoint
CREATE INDEX `idx_dm_queue_userId` ON `dm_queue` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_dm_queue_status` ON `dm_queue` (`status`);--> statement-breakpoint
CREATE INDEX `idx_dm_queue_scheduledAt` ON `dm_queue` (`scheduledAt`);--> statement-breakpoint
CREATE INDEX `idx_hit_records_userId` ON `hit_records` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_hit_records_monitorGroupId` ON `hit_records` (`monitorGroupId`);--> statement-breakpoint
CREATE INDEX `idx_hit_records_keywordId` ON `hit_records` (`keywordId`);--> statement-breakpoint
CREATE INDEX `idx_hit_records_senderTgId` ON `hit_records` (`senderTgId`);--> statement-breakpoint
CREATE INDEX `idx_hit_records_createdAt` ON `hit_records` (`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_keyword_groups_userId` ON `keyword_groups` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_keywords_userId` ON `keywords` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_keywords_groupId` ON `keywords` (`groupId`);--> statement-breakpoint
CREATE INDEX `idx_message_templates_userId` ON `message_templates` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_monitor_groups_userId` ON `monitor_groups` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_monitor_groups_tgAccountId` ON `monitor_groups` (`tgAccountId`);--> statement-breakpoint
CREATE INDEX `idx_tg_accounts_userId` ON `tg_accounts` (`userId`);