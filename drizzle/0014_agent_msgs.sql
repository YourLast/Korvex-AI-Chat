CREATE TABLE `agent_msgs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`from_thread` text NOT NULL,
	`to_thread` text NOT NULL,
	`from_job` text,
	`to_job` text,
	`question` text NOT NULL,
	`answer` text,
	`status` text NOT NULL,
	`user_message_id` text,
	`answer_message_id` text,
	`depth` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`answered_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_msgs_user_idx` ON `agent_msgs` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `agent_msgs_to_idx` ON `agent_msgs` (`to_thread`);