CREATE TABLE `browser_sessions` (
	`thread_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`last_url` text,
	`last_title` text,
	`actions` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`used_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `browser_sessions_user_idx` ON `browser_sessions` (`user_id`,`used_at`);