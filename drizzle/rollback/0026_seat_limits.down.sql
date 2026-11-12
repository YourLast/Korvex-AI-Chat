DROP TABLE `user_notices`;
DROP TABLE `seat_strikes`;
DROP TABLE `seat_events`;
DROP TABLE `seat_signals`;
ALTER TABLE `jobs` DROP COLUMN `card_s`;
ALTER TABLE `users` DROP COLUMN `seat_reset_at`;
ALTER TABLE `users` DROP COLUMN `week_reset_at`;
ALTER TABLE `users` DROP COLUMN `week_mult`;
