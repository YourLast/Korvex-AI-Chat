DROP TABLE `admin_audit`;
ALTER TABLE `users` DROP COLUMN `source`;
ALTER TABLE `users` DROP COLUMN `blocked_by`;
ALTER TABLE `users` DROP COLUMN `blocked_at`;
ALTER TABLE `users` DROP COLUMN `block_reason`;
ALTER TABLE `users` DROP COLUMN `block_kind`;
