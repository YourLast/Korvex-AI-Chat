CREATE TABLE `compare_votes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`question_id` text,
	`message_a` text NOT NULL,
	`message_b` text NOT NULL,
	`winner` text NOT NULL,
	`model_a` text,
	`level_a` text,
	`model_b` text,
	`level_b` text,
	`duration_a` integer,
	`duration_b` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `compare_votes_pair_idx` ON `compare_votes` (`user_id`,`message_a`,`message_b`);--> statement-breakpoint
CREATE INDEX `compare_votes_time_idx` ON `compare_votes` (`updated_at`);--> statement-breakpoint
ALTER TABLE `threads` ADD `compare` text;