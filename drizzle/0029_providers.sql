CREATE TABLE `providers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`base_url` text DEFAULT '' NOT NULL,
	`key_enc` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `admin_models` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`upstream_model` text NOT NULL,
	`name` text NOT NULL,
	`full_name` text DEFAULT '' NOT NULL,
	`blurb` text DEFAULT '' NOT NULL,
	`levels` text NOT NULL,
	`default_level` text NOT NULL,
	`images` integer DEFAULT 0 NOT NULL,
	`tools` integer DEFAULT 0 NOT NULL,
	`context_tokens` integer DEFAULT 32768 NOT NULL,
	`max_output_tokens` integer DEFAULT 4096 NOT NULL,
	`max_concurrent` integer DEFAULT 4 NOT NULL,
	`hidden` integer DEFAULT 0 NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE cascade
);
