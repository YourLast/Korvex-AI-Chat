ALTER TABLE `push_subs` ADD `last_active_at` integer;--> statement-breakpoint
ALTER TABLE `threads` ADD `answered_at` integer;--> statement-breakpoint
ALTER TABLE `threads` ADD `read_at` integer;--> statement-breakpoint
ALTER TABLE `threads` ADD `muted` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `notify_quiet` text DEFAULT '23:00-08:00';