UPDATE `users` SET `role` = 'user' WHERE `role` = 'alpha';
UPDATE `invites` SET `role` = 'user' WHERE `role` = 'alpha';
DELETE FROM `admin_audit` WHERE `admin_id` = 'system' AND `detail` LIKE '%(миграция 0023)';
