CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`thread_id` text,
	`kind` text DEFAULT 'chat' NOT NULL,
	`mode` text DEFAULT 'send' NOT NULL,
	`user_message_id` text,
	`message_id` text,
	`model_id` text NOT NULL,
	`level_id` text NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`api_key_id` text,
	`prompt_tokens` integer,
	`completion_tokens` integer,
	`duration_ms` integer,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `jobs_status_idx` ON `jobs` (`status`);--> statement-breakpoint
CREATE INDEX `jobs_user_idx` ON `jobs` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `jobs_thread_idx` ON `jobs` (`thread_id`);