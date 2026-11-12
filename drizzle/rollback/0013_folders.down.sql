DROP INDEX IF EXISTS `threads_folder_idx`;
ALTER TABLE `threads` DROP COLUMN `folder_id`;
DROP INDEX IF EXISTS `folders_user_idx`;
DROP TABLE IF EXISTS `folders`;
