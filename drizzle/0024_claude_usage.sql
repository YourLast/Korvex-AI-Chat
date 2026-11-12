ALTER TABLE `jobs` ADD `cache_read_tokens` integer;
--> statement-breakpoint
ALTER TABLE `jobs` ADD `cache_write_tokens` integer;
--> statement-breakpoint
ALTER TABLE `jobs` ADD `cost_usd` real;
