ALTER TABLE `tg_accounts` ADD CONSTRAINT `tg_accounts_phone_unique` UNIQUE(`phone`);--> statement-breakpoint
ALTER TABLE `tg_accounts` ADD CONSTRAINT `uq_tg_accounts_phone` UNIQUE(`phone`);