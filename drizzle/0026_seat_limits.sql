ALTER TABLE `jobs` ADD `card_s` real;
--> statement-breakpoint
ALTER TABLE `users` ADD `week_mult` real DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `users` ADD `week_reset_at` integer;
--> statement-breakpoint
ALTER TABLE `users` ADD `seat_reset_at` integer;
--> statement-breakpoint
CREATE TABLE `seat_signals` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`session` text NOT NULL,
	`net` text DEFAULT '' NOT NULL,
	`ua` text DEFAULT '' NOT NULL,
	`jobs` text DEFAULT '' NOT NULL,
	`ov` integer DEFAULT 0 NOT NULL,
	`at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `seat_signals_user_idx` ON `seat_signals` (`user_id`,`at`);
--> statement-breakpoint
CREATE TABLE `seat_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`day` text NOT NULL,
	`kind` text NOT NULL,
	`at` integer NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `seat_events_user_idx` ON `seat_events` (`user_id`,`at`);
--> statement-breakpoint
CREATE TABLE `seat_strikes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `seat_strikes_user_idx` ON `seat_strikes` (`user_id`,`at`);
--> statement-breakpoint
CREATE TABLE `user_notices` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`key` text NOT NULL,
	`at` integer NOT NULL,
	`seen_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_notices_uq` ON `user_notices` (`user_id`,`kind`,`key`);
