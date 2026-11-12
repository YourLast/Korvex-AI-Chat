ALTER TABLE `user_memory` ADD `sure` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `users` ADD `memory_meta` text;
--> statement-breakpoint
UPDATE `user_memory` SET `section` = 'work' WHERE `key` IN ('role', 'company');
