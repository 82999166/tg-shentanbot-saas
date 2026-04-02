CREATE TABLE `group_scrape_results` (
	`id` int AUTO_INCREMENT NOT NULL,
	`taskId` int NOT NULL,
	`keyword` varchar(128) NOT NULL,
	`groupId` varchar(128) NOT NULL,
	`groupTitle` varchar(256),
	`groupType` varchar(32) DEFAULT 'group',
	`memberCount` int DEFAULT 0,
	`description` text,
	`username` varchar(128),
	`realId` varchar(64),
	`importStatus` varchar(32) NOT NULL DEFAULT 'pending',
	`importedAt` timestamp,
	`scrapedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `group_scrape_results_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_gsr_task_group` UNIQUE(`taskId`,`groupId`)
);
--> statement-breakpoint
CREATE TABLE `group_scrape_tasks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(128) NOT NULL,
	`keywords` text NOT NULL,
	`minMemberCount` int NOT NULL DEFAULT 1000,
	`maxResults` int NOT NULL DEFAULT 50,
	`status` varchar(32) NOT NULL DEFAULT 'idle',
	`lastRunAt` timestamp,
	`totalFound` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`fissionEnabled` boolean NOT NULL DEFAULT false,
	`fissionDepth` int NOT NULL DEFAULT 1,
	`fissionMaxPerSeed` int NOT NULL DEFAULT 10,
	CONSTRAINT `group_scrape_tasks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `public_monitor_groups` ADD `realId` varchar(64);--> statement-breakpoint
ALTER TABLE `push_settings` ADD `keywordMatchMode` enum('fuzzy','exact','leftmost','rightmost') DEFAULT 'fuzzy' NOT NULL;--> statement-breakpoint
ALTER TABLE `push_settings` ADD `blacklistMatchMode` enum('fuzzy','exact') DEFAULT 'fuzzy' NOT NULL;--> statement-breakpoint
ALTER TABLE `push_settings` ADD `includeSearchHistory` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `push_settings` ADD `dedupeMinutes` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `push_settings` ADD `blacklistKeywords` text;--> statement-breakpoint
ALTER TABLE `push_settings` ADD `filterBots` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `push_settings` ADD `mediaOnly` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `tg_accounts` ADD `inEngine` boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_gsr_taskId` ON `group_scrape_results` (`taskId`);--> statement-breakpoint
CREATE INDEX `idx_gsr_groupId` ON `group_scrape_results` (`groupId`);--> statement-breakpoint
CREATE INDEX `idx_gsr_importStatus` ON `group_scrape_results` (`importStatus`);