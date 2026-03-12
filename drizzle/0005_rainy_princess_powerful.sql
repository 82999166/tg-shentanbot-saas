CREATE TABLE `group_submissions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`groupLink` varchar(256) NOT NULL,
	`groupTitle` varchar(256),
	`description` text,
	`status` enum('pending','approved','rejected') NOT NULL DEFAULT 'pending',
	`reviewNote` text,
	`reviewedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `group_submissions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `keyword_daily_stats` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`keywordId` int NOT NULL,
	`date` varchar(10) NOT NULL,
	`hitCount` int NOT NULL DEFAULT 0,
	`uniqueSenders` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `keyword_daily_stats_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `push_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`pushEnabled` boolean NOT NULL DEFAULT true,
	`filterAds` boolean NOT NULL DEFAULT false,
	`collaborationGroupId` varchar(64),
	`collaborationGroupTitle` varchar(256),
	`pushFormat` enum('simple','standard','detailed') NOT NULL DEFAULT 'standard',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `push_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `push_settings_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `sender_history` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`senderTgId` varchar(64) NOT NULL,
	`senderUsername` varchar(128),
	`senderFirstName` varchar(128),
	`messageContent` text,
	`groupId` varchar(64),
	`groupTitle` varchar(256),
	`messageDate` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sender_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_group_submissions_userId` ON `group_submissions` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_group_submissions_status` ON `group_submissions` (`status`);--> statement-breakpoint
CREATE INDEX `idx_kds_userId` ON `keyword_daily_stats` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_kds_keywordId` ON `keyword_daily_stats` (`keywordId`);--> statement-breakpoint
CREATE INDEX `idx_kds_date` ON `keyword_daily_stats` (`date`);--> statement-breakpoint
CREATE INDEX `idx_push_settings_userId` ON `push_settings` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_sender_history_userId` ON `sender_history` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_sender_history_senderTgId` ON `sender_history` (`senderTgId`);--> statement-breakpoint
CREATE INDEX `idx_sender_history_messageDate` ON `sender_history` (`messageDate`);