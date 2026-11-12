DROP INDEX IF EXISTS `user_memory_user_idx`;
DROP TABLE IF EXISTS `user_memory`;
ALTER TABLE `threads` DROP COLUMN `temporary`;
ALTER TABLE `users` DROP COLUMN `memory_on`;
ALTER TABLE `users` DROP COLUMN `memory_auto`;
