CREATE TABLE `invite_codes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`code` varchar(32) NOT NULL,
	`totalInvited` int NOT NULL DEFAULT 0,
	`totalPaidInvited` int NOT NULL DEFAULT 0,
	`totalRewardDays` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `invite_codes_id` PRIMARY KEY(`id`),
	CONSTRAINT `invite_codes_userId_unique` UNIQUE(`userId`),
	CONSTRAINT `invite_codes_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `invite_records` (
	`id` int AUTO_INCREMENT NOT NULL,
	`inviterId` int NOT NULL,
	`inviteeId` int NOT NULL,
	`inviteCode` varchar(32) NOT NULL,
	`registrationRewarded` boolean NOT NULL DEFAULT false,
	`paymentRewarded` boolean NOT NULL DEFAULT false,
	`rewardDaysGranted` int NOT NULL DEFAULT 0,
	`registeredAt` timestamp NOT NULL DEFAULT (now()),
	`paidAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `invite_records_id` PRIMARY KEY(`id`),
	CONSTRAINT `invite_records_inviteeId_unique` UNIQUE(`inviteeId`)
);
--> statement-breakpoint
CREATE INDEX `idx_invite_codes_userId` ON `invite_codes` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_invite_codes_code` ON `invite_codes` (`code`);--> statement-breakpoint
CREATE INDEX `idx_invite_records_inviterId` ON `invite_records` (`inviterId`);--> statement-breakpoint
CREATE INDEX `idx_invite_records_inviteeId` ON `invite_records` (`inviteeId`);