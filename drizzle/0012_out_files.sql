CREATE TABLE `out_files` (
	`token` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`thread_id` text,
	`message_id` text,
	`source` text DEFAULT 'job' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `out_files_user_idx` ON `out_files` (`user_id`);