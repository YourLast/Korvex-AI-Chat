CREATE TABLE `ratings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`message_id` text NOT NULL,
	`value` integer NOT NULL,
	`reasons` text,
	`comment` text,
	`model_id` text,
	`level_id` text,
	`duration_ms` integer,
	`prompt_tokens` integer,
	`completion_tokens` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ratings_user_msg_idx` ON `ratings` (`user_id`,`message_id`);--> statement-breakpoint
CREATE INDEX `ratings_time_idx` ON `ratings` (`updated_at`);