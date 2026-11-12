CREATE TABLE `automation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`automation_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`status` text NOT NULL,
	`trigger` text NOT NULL,
	`error` text,
	`message_id` text,
	`duration_ms` integer,
	FOREIGN KEY (`automation_id`) REFERENCES `automations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `runs_auto_idx` ON `automation_runs` (`automation_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `automations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`prompt` text NOT NULL,
	`model_id` text NOT NULL,
	`level_id` text NOT NULL,
	`cron` text NOT NULL,
	`timezone` text NOT NULL,
	`target_thread_id` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`next_run_at` integer,
	`last_run_at` integer,
	`last_status` text,
	`last_error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `automations_user_idx` ON `automations` (`user_id`);--> statement-breakpoint
CREATE INDEX `automations_next_idx` ON `automations` (`enabled`,`next_run_at`);