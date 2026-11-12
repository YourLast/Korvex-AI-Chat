CREATE TABLE `code_edits` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`user_id` text NOT NULL,
	`message_id` text,
	`call_id` text,
	`path` text NOT NULL,
	`source` text DEFAULT 'agent' NOT NULL,
	`before` text,
	`after` text,
	`added` integer DEFAULT 0 NOT NULL,
	`removed` integer DEFAULT 0 NOT NULL,
	`reverted_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `code_edits_thread_idx` ON `code_edits` (`thread_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `code_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`user_id` text NOT NULL,
	`message_id` text,
	`call_id` text,
	`cmd` text NOT NULL,
	`exit_code` integer,
	`output` text DEFAULT '' NOT NULL,
	`test` text,
	`duration_ms` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `code_runs_thread_idx` ON `code_runs` (`thread_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `code_sessions` (
	`thread_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`repo` text NOT NULL,
	`base_branch` text NOT NULL,
	`base_sha` text,
	`work_branch` text,
	`status` text DEFAULT 'cloning' NOT NULL,
	`error` text,
	`origin` text DEFAULT 'code' NOT NULL,
	`pr_url` text,
	`pr_number` integer,
	`pushed_sha` text,
	`tests` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `code_sessions_user_idx` ON `code_sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `github_accounts` (
	`user_id` text PRIMARY KEY NOT NULL,
	`kind` text DEFAULT 'pat' NOT NULL,
	`login` text NOT NULL,
	`gh_id` integer,
	`name` text,
	`avatar_url` text,
	`token_enc` text NOT NULL,
	`scopes` text,
	`expires_at` integer,
	`co_authors` text,
	`created_at` integer NOT NULL,
	`checked_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
