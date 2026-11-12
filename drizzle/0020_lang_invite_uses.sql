ALTER TABLE `users` ADD `lang` text DEFAULT '' NOT NULL;
--> statement-breakpoint
UPDATE `users` SET `lang` = 'ru';
--> statement-breakpoint
ALTER TABLE `invites` ADD `max_uses` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `invites` ADD `uses` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `invites` ADD `revoked_at` integer;
--> statement-breakpoint
UPDATE `invites` SET `uses` = 1 WHERE `used_at` IS NOT NULL;
--> statement-breakpoint
CREATE TABLE `invite_uses` (
	`id` text PRIMARY KEY NOT NULL,
	`invite_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`invite_id`) REFERENCES `invites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `invite_uses_invite_idx` ON `invite_uses` (`invite_id`,`created_at`);
--> statement-breakpoint
INSERT INTO `invite_uses` (`id`, `invite_id`, `user_id`, `name`, `created_at`)
  SELECT lower(hex(randomblob(16))), i.`id`, i.`used_by`, u.`name`, i.`used_at` FROM `invites` i JOIN `users` u ON u.`id` = i.`used_by` WHERE i.`used_by` IS NOT NULL AND i.`used_at` IS NOT NULL;
