DELETE FROM `user_memory` WHERE `sure` = 0;
UPDATE `user_memory` SET `section` = 'facts' WHERE `section` = 'interests';
UPDATE `user_memory` SET `section` = 'who' WHERE `key` IN ('role', 'company');
DELETE FROM `messages` WHERE `thread_id` IN (SELECT `id` FROM `threads` WHERE `temporary` = 2);
DELETE FROM `jobs` WHERE `thread_id` IN (SELECT `id` FROM `threads` WHERE `temporary` = 2);
DELETE FROM `threads` WHERE `temporary` = 2;
ALTER TABLE `users` DROP COLUMN `memory_meta`;
ALTER TABLE `user_memory` DROP COLUMN `sure`;
