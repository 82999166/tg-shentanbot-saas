ALTER TABLE `users` ADD `tgUserId` varchar(32);--> statement-breakpoint
ALTER TABLE `users` ADD `tgUsername` varchar(128);--> statement-breakpoint
ALTER TABLE `users` ADD `tgFirstName` varchar(128);--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_tgUserId_unique` UNIQUE(`tgUserId`);