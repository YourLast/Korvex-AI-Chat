DROP TABLE `bus_relay`;
DROP INDEX `job_commands_owner_idx`;
DROP TABLE `job_commands`;
DROP TABLE `instances`;
ALTER TABLE `automation_runs` DROP COLUMN `owner`;
ALTER TABLE `jobs` DROP COLUMN `owner`;
