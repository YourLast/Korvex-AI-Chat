CREATE TABLE `admin_views` (
	`id` text PRIMARY KEY NOT NULL,
	`admin_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`kind` text NOT NULL,
	`target` text,
	`thread_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `admin_views_time_idx` ON `admin_views` (`created_at`);--> statement-breakpoint
CREATE INDEX `admin_views_owner_idx` ON `admin_views` (`owner_id`,`created_at`);
