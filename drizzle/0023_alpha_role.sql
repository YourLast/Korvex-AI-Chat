INSERT INTO `admin_audit` (`id`, `at`, `admin_id`, `admin_name`, `action`, `target_id`, `target_name`, `target_email`, `reason`, `detail`)
SELECT lower(hex(randomblob(16))), CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER), 'system', 'Korvex', 'role', `id`, `name`, `email`, '', 'Пользователь → Альфа: уже пользовался облачными агентами (миграция 0023)'
FROM `users` WHERE `role` = 'user' AND (`id` IN (SELECT `user_id` FROM `github_accounts`) OR `id` IN (SELECT `user_id` FROM `automations`) OR `id` IN (SELECT `user_id` FROM `code_sessions`));
--> statement-breakpoint
UPDATE `users` SET `role` = 'alpha' WHERE `role` = 'user' AND (`id` IN (SELECT `user_id` FROM `github_accounts`) OR `id` IN (SELECT `user_id` FROM `automations`) OR `id` IN (SELECT `user_id` FROM `code_sessions`));
