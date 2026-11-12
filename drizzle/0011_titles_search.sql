CREATE TABLE `search_dirty` (
	`kind` text NOT NULL,
	`ref` text NOT NULL,
	PRIMARY KEY(`kind`, `ref`)
);
--> statement-breakpoint
CREATE TABLE `search_docs` (
	`id` integer PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`ref` text NOT NULL,
	`thread_id` text NOT NULL,
	`user_id` text NOT NULL,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `search_docs_ref_idx` ON `search_docs` (`kind`,`ref`);--> statement-breakpoint
CREATE INDEX `search_docs_thread_idx` ON `search_docs` (`thread_id`);--> statement-breakpoint
CREATE INDEX `search_docs_user_idx` ON `search_docs` (`user_id`);--> statement-breakpoint
CREATE TABLE `search_meta` (
	`k` text PRIMARY KEY NOT NULL,
	`v` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `threads` ADD `title_manual` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `threads` ADD `title_gen` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE VIRTUAL TABLE `search_fts` USING fts5(body, alt, content='', contentless_delete=1, tokenize='unicode61 remove_diacritics 2', prefix='2 3 4');
--> statement-breakpoint
CREATE TRIGGER `search_msg_ai` AFTER INSERT ON `messages` BEGIN INSERT OR IGNORE INTO `search_dirty` VALUES ('m', new.id); END;
--> statement-breakpoint
CREATE TRIGGER `search_msg_au` AFTER UPDATE OF `content`, `thread_id` ON `messages` BEGIN INSERT OR IGNORE INTO `search_dirty` VALUES ('m', new.id); END;
--> statement-breakpoint
CREATE TRIGGER `search_msg_ad` AFTER DELETE ON `messages` BEGIN INSERT OR IGNORE INTO `search_dirty` VALUES ('m', old.id); END;
--> statement-breakpoint
CREATE TRIGGER `search_thr_ai` AFTER INSERT ON `threads` BEGIN INSERT OR IGNORE INTO `search_dirty` VALUES ('t', new.id); END;
--> statement-breakpoint
CREATE TRIGGER `search_thr_au` AFTER UPDATE OF `title`, `user_id`, `model_id` ON `threads` BEGIN INSERT OR IGNORE INTO `search_dirty` VALUES ('t', new.id); END;
--> statement-breakpoint
CREATE TRIGGER `search_thr_ad` AFTER DELETE ON `threads` BEGIN INSERT OR IGNORE INTO `search_dirty` VALUES ('t', old.id); END;
--> statement-breakpoint
CREATE TRIGGER `search_file_ai` AFTER INSERT ON `files` BEGIN INSERT OR IGNORE INTO `search_dirty` VALUES ('f', new.id); END;
--> statement-breakpoint
CREATE TRIGGER `search_file_au` AFTER UPDATE OF `name`, `thread_id` ON `files` BEGIN INSERT OR IGNORE INTO `search_dirty` VALUES ('f', new.id); END;
--> statement-breakpoint
CREATE TRIGGER `search_file_ad` AFTER DELETE ON `files` BEGIN INSERT OR IGNORE INTO `search_dirty` VALUES ('f', old.id); END;
--> statement-breakpoint
INSERT OR IGNORE INTO `search_dirty` SELECT 't', `id` FROM `threads`;
--> statement-breakpoint
INSERT OR IGNORE INTO `search_dirty` SELECT 'm', `id` FROM `messages`;
--> statement-breakpoint
INSERT OR IGNORE INTO `search_dirty` SELECT 'f', `id` FROM `files` WHERE `thread_id` IS NOT NULL;
