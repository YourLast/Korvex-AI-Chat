DROP INDEX IF EXISTS `compare_votes_pair_idx`;
DROP INDEX IF EXISTS `compare_votes_time_idx`;
DROP TABLE IF EXISTS `compare_votes`;
ALTER TABLE `threads` DROP COLUMN `compare`;
