ALTER TABLE `files` ADD `folder_id` text;
--> statement-breakpoint
ALTER TABLE `files` ADD `doc_type` text;
--> statement-breakpoint
ALTER TABLE `files` ADD `doc_date` text;
--> statement-breakpoint
ALTER TABLE `files` ADD `doc_from` text;
--> statement-breakpoint
ALTER TABLE `files` ADD `doc_to` text;
--> statement-breakpoint
CREATE INDEX `files_user_folder` ON `files` (`user_id`,`folder_id`);
