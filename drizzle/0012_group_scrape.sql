-- 群组采集任务表
CREATE TABLE IF NOT EXISTS `group_scrape_tasks` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `name` varchar(128) NOT NULL,
  `keywords` text NOT NULL,
  `minMemberCount` int NOT NULL DEFAULT 1000,
  `maxResults` int NOT NULL DEFAULT 50,
  `status` varchar(32) NOT NULL DEFAULT 'idle',
  `lastRunAt` timestamp NULL,
  `totalFound` int DEFAULT 0,
  `createdAt` timestamp NOT NULL DEFAULT now(),
  `updatedAt` timestamp NOT NULL DEFAULT now() ON UPDATE now()
);

-- 群组采集结果表
CREATE TABLE IF NOT EXISTS `group_scrape_results` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `taskId` int NOT NULL,
  `keyword` varchar(128) NOT NULL,
  `groupId` varchar(128) NOT NULL,
  `groupTitle` varchar(256),
  `groupType` varchar(32) DEFAULT 'group',
  `memberCount` int DEFAULT 0,
  `description` text,
  `username` varchar(128),
  `realId` varchar(64),
  `importStatus` varchar(32) NOT NULL DEFAULT 'pending',
  `importedAt` timestamp NULL,
  `scrapedAt` timestamp NOT NULL DEFAULT now(),
  INDEX `idx_gsr_taskId` (`taskId`),
  INDEX `idx_gsr_groupId` (`groupId`),
  INDEX `idx_gsr_importStatus` (`importStatus`),
  UNIQUE INDEX `idx_gsr_task_group` (`taskId`, `groupId`)
);
