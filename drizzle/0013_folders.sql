CREATE TABLE `folders` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`instruction` text DEFAULT '' NOT NULL,
	`collapsed` integer DEFAULT 0 NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `folders_user_idx` ON `folders` (`user_id`,`sort`);--> statement-breakpoint
ALTER TABLE `threads` ADD `folder_id` text REFERENCES folders(id) ON DELETE set null;--> statement-breakpoint
CREATE INDEX `threads_folder_idx` ON `threads` (`folder_id`);