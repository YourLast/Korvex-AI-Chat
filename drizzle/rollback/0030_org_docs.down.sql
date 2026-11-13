DROP INDEX IF EXISTS `files_user_folder`;
ALTER TABLE `files` DROP COLUMN `doc_to`;
ALTER TABLE `files` DROP COLUMN `doc_from`;
ALTER TABLE `files` DROP COLUMN `doc_date`;
ALTER TABLE `files` DROP COLUMN `doc_type`;
ALTER TABLE `files` DROP COLUMN `folder_id`;
