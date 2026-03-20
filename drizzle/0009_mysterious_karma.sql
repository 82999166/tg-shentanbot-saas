CREATE TABLE `public_group_join_status` (
	`id` int AUTO_INCREMENT NOT NULL,
	`publicGroupId` int NOT NULL,
	`monitorAccountId` int NOT NULL,
	`status` varchar(32) NOT NULL DEFAULT 'pending',
	`errorMsg` varchar(512),
	`joinedAt` timestamp,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `public_group_join_status_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_pgjs_unique` UNIQUE(`publicGroupId`,`monitorAccountId`)
);
--> statement-breakpoint
CREATE TABLE `public_group_keywords` (
	`id` int AUTO_INCREMENT NOT NULL,
	`publicGroupId` int NOT NULL,
	`pattern` varchar(256) NOT NULL,
	`matchType` varchar(32) DEFAULT 'contains',
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `public_group_keywords_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_pgjs_groupId` ON `public_group_join_status` (`publicGroupId`);--> statement-breakpoint
CREATE INDEX `idx_pgjs_accountId` ON `public_group_join_status` (`monitorAccountId`);--> statement-breakpoint
CREATE INDEX `idx_pgk_groupId` ON `public_group_keywords` (`publicGroupId`);--> statement-breakpoint
CREATE INDEX `idx_pgk_isActive` ON `public_group_keywords` (`isActive`);