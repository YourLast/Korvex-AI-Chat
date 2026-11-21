CREATE TABLE `cbr_rates` (
	`asked` text PRIMARY KEY NOT NULL,
	`set_date` text NOT NULL,
	`rates` text NOT NULL,
	`fetched_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `block_usage` (
	`day` text NOT NULL,
	`kind` text NOT NULL,
	`provider` text DEFAULT '' NOT NULL,
	`n` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`day`, `kind`, `provider`)
);
