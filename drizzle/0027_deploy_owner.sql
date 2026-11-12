ALTER TABLE `jobs` ADD `owner` text;
--> statement-breakpoint
ALTER TABLE `automation_runs` ADD `owner` text;
--> statement-breakpoint
CREATE TABLE `instances` (
	`id` text PRIMARY KEY NOT NULL,
	`pid` integer NOT NULL,
	`build` text,
	`admin_port` integer,
	`state` text DEFAULT 'live' NOT NULL,
	`started_at` integer NOT NULL,
	`heartbeat_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `job_commands` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`owner` text NOT NULL,
	`kind` text NOT NULL,
	`payload` text,
	`created_at` integer NOT NULL,
	`taken_at` integer
);
--> statement-breakpoint
CREATE INDEX `job_commands_owner_idx` ON `job_commands` (`owner`,`taken_at`);
--> statement-breakpoint
CREATE TABLE `bus_relay` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`origin` text NOT NULL,
	`user_id` text NOT NULL,
	`event` text NOT NULL,
	`at` integer NOT NULL
);
