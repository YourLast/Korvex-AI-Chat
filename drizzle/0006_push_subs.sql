CREATE TABLE `push_subs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`device` text NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`ua` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`last_ok_at` integer,
	`fails` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subs_endpoint_unique` ON `push_subs` (`endpoint`);--> statement-breakpoint
CREATE INDEX `push_user_idx` ON `push_subs` (`user_id`);