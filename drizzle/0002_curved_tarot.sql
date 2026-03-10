CREATE TABLE `bot_configs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`botToken` varchar(256),
	`botUsername` varchar(128),
	`notifyEnabled` boolean NOT NULL DEFAULT true,
	`notifyTargetChatId` varchar(64),
	`notifyFormat` enum('simple','standard','detailed') NOT NULL DEFAULT 'standard',
	`isActive` boolean NOT NULL DEFAULT false,
	`lastActiveAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `bot_configs_id` PRIMARY KEY(`id`),
	CONSTRAINT `bot_configs_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `payment_orders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`planId` enum('basic','pro','enterprise') NOT NULL,
	`durationMonths` int NOT NULL DEFAULT 1,
	`usdtAmount` decimal(18,6) NOT NULL,
	`usdtAddress` varchar(128) NOT NULL,
	`network` enum('trc20','erc20','bep20') NOT NULL DEFAULT 'trc20',
	`txHash` varchar(128),
	`confirmedAt` timestamp,
	`status` enum('pending','confirming','completed','expired','failed') NOT NULL DEFAULT 'pending',
	`expiredAt` timestamp NOT NULL,
	`redeemCode` varchar(64),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `payment_orders_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `redeem_codes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(64) NOT NULL,
	`planId` enum('basic','pro','enterprise') NOT NULL,
	`durationMonths` int NOT NULL DEFAULT 1,
	`status` enum('unused','used','expired') NOT NULL DEFAULT 'unused',
	`usedByUserId` int,
	`usedAt` timestamp,
	`orderId` int,
	`batchId` varchar(64),
	`expiresAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `redeem_codes_id` PRIMARY KEY(`id`),
	CONSTRAINT `redeem_codes_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `system_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`key` varchar(128) NOT NULL,
	`value` text,
	`description` text,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `system_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `system_settings_key_unique` UNIQUE(`key`)
);
--> statement-breakpoint
CREATE INDEX `idx_bot_configs_userId` ON `bot_configs` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_payment_orders_userId` ON `payment_orders` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_payment_orders_status` ON `payment_orders` (`status`);--> statement-breakpoint
CREATE INDEX `idx_payment_orders_usdtAmount` ON `payment_orders` (`usdtAmount`);--> statement-breakpoint
CREATE INDEX `idx_redeem_codes_code` ON `redeem_codes` (`code`);--> statement-breakpoint
CREATE INDEX `idx_redeem_codes_status` ON `redeem_codes` (`status`);--> statement-breakpoint
CREATE INDEX `idx_redeem_codes_orderId` ON `redeem_codes` (`orderId`);