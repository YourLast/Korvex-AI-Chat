ALTER TABLE `messages` ADD `parent_id` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `session` text;--> statement-breakpoint
ALTER TABLE `threads` ADD `leaf_id` text;--> statement-breakpoint
UPDATE `messages` SET `parent_id` = (SELECT m2.`id` FROM `messages` m2 WHERE m2.`thread_id` = `messages`.`thread_id` AND m2.`seq` = `messages`.`seq` - 1)
--> statement-breakpoint
UPDATE `messages` SET `session` = `thread_id` WHERE `role` = 'user'
--> statement-breakpoint
UPDATE `threads` SET `leaf_id` = (SELECT m.`id` FROM `messages` m WHERE m.`thread_id` = `threads`.`id` ORDER BY m.`seq` DESC LIMIT 1)
