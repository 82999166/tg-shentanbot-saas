CREATE TABLE `public_monitor_groups` (
	`id` int AUTO_INCREMENT NOT NULL,
	`groupId` varchar(128) NOT NULL,
	`groupTitle` varchar(256),
	`groupType` varchar(32) DEFAULT 'group',
	`memberCount` int DEFAULT 0,
	`isActive` boolean NOT NULL DEFAULT true,
	`addedBy` int,
	`note` varchar(512),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `public_monitor_groups_id` PRIMARY KEY(`id`),
	CONSTRAINT `public_monitor_groups_groupId_unique` UNIQUE(`groupId`)
);
--> statement-breakpoint
CREATE INDEX `idx_pmg_groupId` ON `public_monitor_groups` (`groupId`);--> statement-breakpoint
CREATE INDEX `idx_pmg_isActive` ON `public_monitor_groups` (`isActive`);