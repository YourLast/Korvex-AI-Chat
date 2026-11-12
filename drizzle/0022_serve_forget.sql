CREATE TABLE `serve_forget` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`base_url` text NOT NULL,
	`created_at` integer NOT NULL,
	`tries` integer DEFAULT 0 NOT NULL,
	`next_at` integer NOT NULL,
	`last_error` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `serve_forget_uq` ON `serve_forget` (`chat_id`,`base_url`);
--> statement-breakpoint
CREATE INDEX `serve_forget_next_idx` ON `serve_forget` (`next_at`);
