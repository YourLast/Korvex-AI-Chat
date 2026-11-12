CREATE TABLE `user_memory` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`section` text NOT NULL,
	`key` text,
	`text` text NOT NULL,
	`origin` text DEFAULT 'auto' NOT NULL,
	`thread_id` text,
	`message_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `user_memory_user_idx` ON `user_memory` (`user_id`,`section`);--> statement-breakpoint
ALTER TABLE `threads` ADD `temporary` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `memory_on` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `memory_auto` integer DEFAULT 1 NOT NULL;