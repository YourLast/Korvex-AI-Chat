CREATE TABLE `org_inbox` (
	`folder_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`tag` text NOT NULL,
	`senders` text DEFAULT '[]' NOT NULL,
	`key_hash` text,
	`key_hint` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`folder_id`) REFERENCES `folders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `org_inbox_tag` ON `org_inbox` (`tag`);
--> statement-breakpoint
CREATE UNIQUE INDEX `org_inbox_key` ON `org_inbox` (`key_hash`);
