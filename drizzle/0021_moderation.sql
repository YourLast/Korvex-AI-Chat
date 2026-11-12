ALTER TABLE `users` ADD `block_kind` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `users` ADD `block_reason` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `users` ADD `blocked_at` integer;
--> statement-breakpoint
ALTER TABLE `users` ADD `blocked_by` text;
--> statement-breakpoint
ALTER TABLE `users` ADD `source` text DEFAULT '' NOT NULL;
--> statement-breakpoint
UPDATE `users` SET `block_kind` = 'pause' WHERE `disabled` = 1;
--> statement-breakpoint
CREATE TABLE `admin_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`at` integer NOT NULL,
	`admin_id` text NOT NULL,
	`admin_name` text DEFAULT '' NOT NULL,
	`action` text NOT NULL,
	`target_id` text,
	`target_name` text DEFAULT '' NOT NULL,
	`target_email` text DEFAULT '' NOT NULL,
	`invite_id` text,
	`reason` text DEFAULT '' NOT NULL,
	`detail` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `admin_audit_time_idx` ON `admin_audit` (`at`);
--> statement-breakpoint
CREATE INDEX `admin_audit_target_idx` ON `admin_audit` (`target_id`,`at`);
