DROP TABLE `invite_uses`;
ALTER TABLE `invites` DROP COLUMN `revoked_at`;
ALTER TABLE `invites` DROP COLUMN `uses`;
ALTER TABLE `invites` DROP COLUMN `max_uses`;
ALTER TABLE `users` DROP COLUMN `lang`;
